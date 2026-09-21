import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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
