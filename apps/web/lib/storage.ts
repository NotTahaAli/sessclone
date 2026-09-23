import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ArtifactKind } from '@sessclone/shared'

// ADR 0003: the bytes never pass through this application. The Collector PUTs
// straight to storage with a URL issued here, which is why this module knows
// how to sign a request and nothing about transcripts.
//
// Only the S3 API is used, and no code path knows the provider: Supabase
// Storage, Cloudflare R2, AWS, Oracle Cloud and MinIO are the same five
// environment variables (`docs/configuration.md` § Storage). `forcePathStyle`
// defaults to true because MinIO and Supabase require it and AWS accepts it —
// the opposite default would break a self-hoster and work for us, which is the
// wrong way round.

export const PRESIGN_TTL_SECONDS = 300

/** SigV4's own ceiling: a presign beyond a week is refused by the signer. */
const MAX_TTL_SECONDS = 604_800

/** S3's object key limit, in bytes rather than characters. */
export const MAX_KEY_BYTES = 1024

let client: S3Client | undefined

const storage = () => {
  // As in `lib/db.ts`: name what is missing rather than failing inside the
  // client with something about an invalid URL. A deployment without storage
  // configured has archival switched off, not half-working.
  const endpoint = required('STORAGE_ENDPOINT')
  const accessKeyId = required('STORAGE_ACCESS_KEY_ID')
  const secretAccessKey = required('STORAGE_SECRET_ACCESS_KEY')

  return (client ??= new S3Client({
    endpoint,
    region: process.env.STORAGE_REGION ?? 'auto',
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== 'false',
    credentials: { accessKeyId, secretAccessKey },
    // Since 3.731.0 the S3 client computes a CRC32 over the request body by
    // default and hoists it into the signed query string. A presign has no
    // body, so what gets signed is the checksum of zero bytes — and the
    // provider then refuses every upload that actually carries a transcript.
    // `WHEN_REQUIRED` leaves it off for PutObject, which is what a presigned
    // PUT needs: the transcript's own hash is checked by us, before the bytes
    // move.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  }))
}

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/** Whether this deployment can archive at all. */
export const storageConfigured = () =>
  Boolean(
    process.env.STORAGE_ENDPOINT &&
    process.env.STORAGE_BUCKET &&
    process.env.STORAGE_ACCESS_KEY_ID &&
    process.env.STORAGE_SECRET_ACCESS_KEY,
  )

/** The longest a single segment may be, so no key runs past a provider's limit. */
const MAX_SEGMENT = 120

/**
 * One path segment, made of characters every provider accepts.
 *
 * Percent-encoding was the obvious answer and is the wrong one: Supabase
 * Storage refuses a key containing `%` outright — `InvalidKey`, 400, after the
 * whole transcript has been sent — which is how every upload to this
 * deployment failed silently on 2026-09-22 while presign answered 200. So a
 * segment is transliterated rather than escaped, to letters, digits, dot,
 * dash and underscore.
 *
 * It is not reversible, and does not need to be: `log_artifacts` records the
 * key it stored under, and nothing reads a Project or Session id back out of
 * a path. What it must be is *contained* — no slash survives, so a Project key
 * like `host/owner/repo` cannot escape its own segment, and no leading dot
 * survives, so nothing resolves upwards.
 *
 * Two different values can transliterate alike. That is harmless here: the
 * segments below it are a Session id, which belongs to one Project, and the
 * row in the database is what says which is which.
 */
const segment = (raw: string) => {
  const safe = raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, MAX_SEGMENT)
  return safe || 'unnamed'
}

/**
 * The object key for one Session's transcript, from ADR 0003.
 *
 * ```
 * orgs/<org>/members/<member>/projects/<project key>/<session>.jsonl
 *   …/<session>/agents/<agent>.jsonl             an Agent Run
 *   …/<session>/agents/<agent>.meta.json         its sidecar (ticket 104)
 *   …/<session>/workflows/<run>.journal.jsonl    a workflow's journal
 * ```
 *
 * Every segment a Collector influences — the Project key, which carries
 * slashes as `host/owner/repo` or an absolute path, and the Session and Agent
 * ids, which arrive from a machine we do not control — goes through
 * {@link segment}. Raw, they would break the prefix a per-Project sweep
 * depends on (ADR 0005) and let a key escape its own prefix.
 */
export const artifactKey = (artifact: {
  orgId: string
  memberId: string
  projectKey: string | null
  sessionId: string
  agentId: string | null
  /** Ticket 104: a sidecar sits beside the transcript it describes. */
  kind?: ArtifactKind
}) => {
  const session = segment(artifact.sessionId)
  const agent = artifact.agentId && segment(artifact.agentId)
  const name =
    artifact.kind === 'workflow_journal'
      ? `${session}/workflows/${agent ?? 'unnamed'}.journal.jsonl`
      : artifact.kind === 'agent_meta'
        ? `${session}/agents/${agent ?? 'unnamed'}.meta.json`
        : agent
          ? `${session}/agents/${agent}.jsonl`
          : `${session}.jsonl`

  // A Session outside any repository still has a transcript, and it needs a
  // segment of its own rather than an empty one — two slashes in a row is a
  // different key to some providers and the same to others.
  const project = segment(artifact.projectKey ?? 'none')

  return `orgs/${artifact.orgId}/members/${artifact.memberId}/projects/${project}/${name}`
}

/**
 * A short-lived PUT URL for one object.
 *
 * A presigned URL is a bearer credential, so its life is short and
 * configurable — five minutes by default, which is long enough to upload a
 * transcript on a bad connection and short enough that a leaked URL is a
 * window rather than a grant.
 *
 * `ContentType` is deliberately absent: only `host` is signed, so a content
 * type set here reaches neither the URL nor the stored object. The Collector
 * sends its own.
 *
 * `ChecksumSHA256` is deliberately not set: the Collector's hash is base16 and
 * S3 wants base64, and signing the checksum would make the URL refuse an
 * upload whose bytes changed between the hash and the PUT — which is exactly
 * what happens to a transcript that grows while it is being read.
 */
export const presignUpload = async (key: string) =>
  getSignedUrl(
    storage(),
    new PutObjectCommand({
      Bucket: required('STORAGE_BUCKET'),
      Key: key,
    }),
    { expiresIn: ttl() },
  )

/**
 * How long an issued URL lives, in seconds — and the number the Collector is
 * told, so the two cannot disagree.
 *
 * Clamped at both ends. A negative or unparseable setting falls back to the
 * default; anything past SigV4's week makes the signer throw, which would turn
 * a configuration mistake into a 500 on every upload.
 */
export const ttl = () => {
  const configured = Number(process.env.STORAGE_PRESIGN_TTL_SECONDS)
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, MAX_TTL_SECONDS)
    : PRESIGN_TTL_SECONDS
}

/**
 * A short-lived GET URL for one object (ticket 60).
 *
 * The bytes never come through the application on the way out either (ADR
 * 0003): the browser is redirected to storage, which is what keeps a
 * gigabyte of transcripts off the server's memory and out of its request
 * timeout. The URL is a bearer credential with the same short life as the
 * upload's, and the download's authorisation happened before it was signed.
 *
 * `ResponseContentDisposition` is what makes a browser save the file under a
 * readable name rather than render the object key: the object is `.jsonl`,
 * and the key is a path with a percent-encoded Project in it.
 *
 * The filename is built from a Session id a Collector sent, so it is treated
 * as hostile input: quotes and backslashes would end the quoted string early,
 * and `\p{C}` covers the control characters (so CR and LF, which would split
 * the header) along with the formatting ones (so U+202E, which would show a
 * reader a different extension to the one they are saving). Bounded too,
 * because the whole value travels in a signed query string that a provider
 * may refuse for length. `filename*` carries the non-ASCII form per RFC 6266,
 * since the quoted `filename` is only reliably read as ASCII.
 */
export const presignDownload = async (
  key: string,
  filename: string,
  contentType = 'application/x-ndjson',
) => {
  const clean = filename.replaceAll(/["\\\p{C}]/gu, '').slice(0, 200)
  return getSignedUrl(
    storage(),
    new GetObjectCommand({
      Bucket: required('STORAGE_BUCKET'),
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition:
        `attachment; filename="${clean}"; ` +
        `filename*=UTF-8''${encodeURIComponent(clean)}`,
    }),
    { expiresIn: ttl() },
  )
}

/**
 * The size of a stored object, or null when it is not there.
 *
 * Ticket 59's confirm route reads this rather than believing the Collector:
 * the row it writes is the dashboard's claim that a transcript is downloadable,
 * and a Collector whose upload failed after answering — or was truncated —
 * would otherwise make that claim on its behalf. The size is the provider's
 * own count of the bytes it holds.
 *
 * A missing object is null rather than a throw: it is an ordinary answer on
 * this path, because a provider may be eventually consistent and the Collector
 * simply confirms again.
 */
export const storedObject = async (key: string) => {
  try {
    const head = await storage().send(
      new HeadObjectCommand({ Bucket: required('STORAGE_BUCKET'), Key: key }),
    )
    return { sizeBytes: head.ContentLength ?? 0 }
  } catch (error) {
    // 404 and 403 both mean "no object to record here" as far as this route is
    // concerned: some providers answer a HEAD on a missing key with 403 rather
    // than 404 when the credential cannot list the bucket.
    const status =
      typeof error === 'object' && error !== null
        ? ((error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode ?? 0)
        : 0
    if (status === 404 || status === 403) return null
    throw error
  }
}

/** S3 takes at most a thousand keys in one delete. */
const DELETE_BATCH = 1000

/**
 * Deletes the named objects, in batches of a thousand, and raises unless
 * every one of them went.
 *
 * Deleting an object that is not there succeeds, which is what makes ticket
 * 73's deletion safe to re-run: the failure mode worth avoiding is a row
 * whose bytes are gone, and a second sweep that raises on a missing key would
 * create exactly that.
 */
export const deleteObjects = async (keys: string[]) => {
  const bucket = required('STORAGE_BUCKET')
  for (let from = 0; from < keys.length; from += DELETE_BATCH) {
    const batch = keys.slice(from, from + DELETE_BATCH)
    // Sequential on purpose: a thousand keys a round trip is already one
    // request per thousand objects, and firing every batch at once is how a
    // sweep of a large Project rate-limits itself.
    // eslint-disable-next-line no-await-in-loop
    const answer = await storage().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    )

    // S3 answers 200 with a per-key result, so a refused key is not a
    // rejected promise: `Quiet` asks for the failures alone, and dropping
    // them would let a sweep that deleted nothing report success. The caller
    // deletes the rows in a transaction that commits after this, so throwing
    // here is what keeps the row and its bytes together — the transcripts
    // stay, and so do the rows that can still find them.
    if (answer.Errors?.length) {
      const [first] = answer.Errors
      throw new Error(
        `${answer.Errors.length} object(s) were not deleted: ${first?.Code ?? 'unknown'}`,
      )
    }
  }
}
