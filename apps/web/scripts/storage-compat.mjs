// Ticket 67: does this deployment's storage actually work on the provider it
// is pointed at?
//
// The one thing a self-hoster cannot tell from `next build` is whether their
// bucket speaks the parts of the S3 API this product depends on — and those
// are narrower and stranger than "S3-compatible" suggests:
//
//   - a presigned PUT that carries no checksum header (the SDK signs a CRC32
//     of an empty body by default, which every provider then refuses),
//   - `HeadObject`, which the confirm route reads the size back from rather
//     than believing the Collector,
//   - a presigned GET carrying `response-content-disposition`, which is what
//     makes a download save under a readable name,
//   - `DeleteObjects`, whose per-key failures arrive in a 200.
//
// Run it against anything, with the same five variables the application uses:
//
//   STORAGE_ENDPOINT=… STORAGE_BUCKET=… STORAGE_ACCESS_KEY_ID=… \
//   STORAGE_SECRET_ACCESS_KEY=… node apps/web/scripts/storage-compat.mjs
//
// It writes and deletes one object under `storage-compat/`, prints a line per
// check, and stops at the first failure with a non-zero exit — every check
// after the first depends on the one before it, so carrying on would bury the
// real error under cascaded ones. Nothing here is part of the test suite: it
// needs a provider, and CI has none.

import { createHash } from 'node:crypto'

import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

const need = (name) => {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} is not set. See docs/configuration.md § Storage.`)
    process.exit(2)
  }
  return value
}

const bucket = need('STORAGE_BUCKET')
const client = new S3Client({
  endpoint: need('STORAGE_ENDPOINT'),
  region: process.env.STORAGE_REGION ?? 'auto',
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: need('STORAGE_ACCESS_KEY_ID'),
    secretAccessKey: need('STORAGE_SECRET_ACCESS_KEY'),
  },
  // The same setting the application runs with, and the reason it is here is
  // in `apps/web/lib/storage.ts`.
  requestChecksumCalculation: 'WHEN_REQUIRED',
})

const key = `storage-compat/${Date.now()}-${process.pid}.jsonl`
const body = '{"type":"assistant","message":{"id":"msg_compat"}}\n'
const sha256 = createHash('sha256').update(body).digest('hex')

/** The presigned PUT, issued by one check and used by the next. */
let put = ''

/**
 * Runs one check, and exits the process if it failed.
 *
 * Each check is the next one's precondition — no presigned URL means no
 * upload, no upload means nothing to head — so continuing after a failure
 * prints four more failures that say nothing and hide the one that does. The
 * object is left in the bucket when this exits early, under
 * `storage-compat/`, which is the one thing to sweep by hand afterwards.
 */
const check = async (what, run) => {
  try {
    const note = await run()
    console.log(`  ok    ${what}${note ? ` — ${String(note)}` : ''}`)
  } catch (error) {
    console.log(
      `  FAIL  ${what}: ${error instanceof Error ? error.message : String(error)}`,
    )
    console.log('\nnot compatible')
    process.exit(1)
  }
}

console.log(`${process.env.STORAGE_ENDPOINT} · bucket ${bucket}`)

if (process.env.STORAGE_COMPAT_CREATE_BUCKET === 'true') {
  await check('create the bucket', async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
  })
}

await check('presign a PUT with no checksum in the signature', async () => {
  const url = new URL(
    await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key }),
      {
        expiresIn: 300,
      },
    ),
  )
  if ([...url.searchParams.keys()].some((name) => name.includes('checksum'))) {
    throw new Error('a checksum of the empty body was signed into the URL')
  }
  put = url.toString()
  return 'no checksum parameter'
})

await check('upload the bytes through that URL', async () => {
  const answer = await fetch(put, {
    method: 'PUT',
    headers: { 'content-length': String(Buffer.byteLength(body)) },
    body,
  })
  if (!answer.ok) throw new Error(`${answer.status} ${await answer.text()}`)
})

await check('read the size back with HeadObject', async () => {
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  )
  if (head.ContentLength !== Buffer.byteLength(body)) {
    throw new Error(
      `${head.ContentLength} bytes, expected ${Buffer.byteLength(body)}`,
    )
  }
  return `${head.ContentLength} bytes`
})

await check('download with a filename and the right bytes', async () => {
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: 'application/x-ndjson',
      ResponseContentDisposition: 'attachment; filename="session.jsonl"',
    }),
    { expiresIn: 300 },
  )
  const answer = await fetch(url)
  if (!answer.ok) throw new Error(`${answer.status} ${await answer.text()}`)
  const returned = await answer.text()
  if (createHash('sha256').update(returned).digest('hex') !== sha256) {
    throw new Error('the bytes that came back are not the bytes that went')
  }
  const disposition = answer.headers.get('content-disposition')
  if (!disposition?.includes('session.jsonl')) {
    throw new Error(`content-disposition was ${disposition ?? 'absent'}`)
  }
  return disposition
})

await check('delete it, and report per-key failures', async () => {
  const answer = await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: [{ Key: key }], Quiet: true },
    }),
  )
  if (answer.Errors?.length) {
    throw new Error(
      answer.Errors.map((one) => `${one.Key}: ${one.Code}`).join(', '),
    )
  }
})

await check('a deleted object is gone', async () => {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    if (status === 404) return 'answers 404'
    // 403 is not proof of absence. `lib/storage.ts` treats it as "no object to
    // record here" because a credential that cannot list the bucket answers a
    // HEAD on a *missing* key that way — but it answers the same on a key that
    // is still there, so accepting it here would pass a bucket whose delete
    // silently did nothing. That is the one false pass a compatibility script
    // must not give.
    if (status === 403) {
      throw new Error(
        'this credential answers 403 rather than 404, so whether the delete ' +
          'took cannot be told from here — grant it read on the bucket and ' +
          'run this again',
        { cause: error },
      )
    }
    throw error
  }
  throw new Error('it is still there')
})

console.log('\ncompatible')
