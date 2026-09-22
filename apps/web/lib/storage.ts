import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

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

/**
 * The object key for one Session's transcript, from ADR 0003.
 *
 * ```
 * orgs/<org>/members/<member>/projects/<project key>/<session>.jsonl
 * ```
 *
 * The Project key contains slashes — `host/owner/repo`, or a `local:` key
 * carrying an absolute path — so it is percent-encoded into one segment.
 * Raw, it would both break the prefix a per-Project sweep depends on (ADR
 * 0005) and let a key escape its own prefix. The Session and Agent ids are
 * encoded for the same reason: they arrive from a Collector.
 */
export const artifactKey = (artifact: {
  orgId: string
  memberId: string
  projectKey: string | null
  sessionId: string
  agentId: string | null
}) => {
  const name = artifact.agentId
    ? `${encodeURIComponent(artifact.sessionId)}/agents/${encodeURIComponent(artifact.agentId)}.jsonl`
    : `${encodeURIComponent(artifact.sessionId)}.jsonl`

  // A Session outside any repository still has a transcript, and it needs a
  // segment of its own rather than an empty one — two slashes in a row is a
  // different key to some providers and the same to others.
  const project = encodeURIComponent(artifact.projectKey ?? 'none')

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
export const presignDownload = async (key: string, filename: string) => {
  const clean = filename.replaceAll(/["\\\p{C}]/gu, '').slice(0, 200)
  return getSignedUrl(
    storage(),
    new GetObjectCommand({
      Bucket: required('STORAGE_BUCKET'),
      Key: key,
      ResponseContentType: 'application/x-ndjson',
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
