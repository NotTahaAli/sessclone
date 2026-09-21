import { beforeEach, expect, test, vi } from 'vitest'

// Ticket 58's other half: the URL itself.
//
// The route's tests stub the signer, so nothing there would notice a URL that
// every provider refuses — which is what the SDK's default checksum behaviour
// produces for a presign, since it signs a CRC32 of the empty body a presign
// has.

const ENV = {
  STORAGE_ENDPOINT: 'https://storage.test',
  STORAGE_BUCKET: 'transcripts',
  STORAGE_ACCESS_KEY_ID: 'key',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
}

beforeEach(() => {
  Object.assign(process.env, ENV)
  delete process.env.STORAGE_PRESIGN_TTL_SECONDS
})

test('the signed URL binds no checksum of the body it has not seen', async () => {
  const { presignUpload } = await import('../lib/storage')

  const url = new URL(await presignUpload('orgs/a/members/b/session-1.jsonl'))

  // `x-amz-checksum-crc32=AAAAAA==` is CRC32 of zero bytes: signed into the
  // URL, it makes every upload that carries an actual transcript fail with
  // BadDigest after the bytes have moved.
  expect([...url.searchParams.keys()]).not.toContain('x-amz-checksum-crc32')
  expect([...url.searchParams.keys()]).not.toContain(
    'x-amz-sdk-checksum-algorithm',
  )
  expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
  expect(url.pathname).toContain('session-1.jsonl')
})

test('the advertised life and the signed life are one number, and bounded', async () => {
  const { ttl } = await import('../lib/storage')

  expect(ttl()).toBe(300)

  // A week is SigV4's ceiling; past it the signer throws, which would turn a
  // configuration mistake into a 500 on every upload.
  process.env.STORAGE_PRESIGN_TTL_SECONDS = '2000000'
  expect(ttl()).toBe(604_800)

  // Nonsense falls back rather than travelling to the Collector as the number
  // it schedules its retry by.
  process.env.STORAGE_PRESIGN_TTL_SECONDS = '-1'
  expect(ttl()).toBe(300)
})

test('the signed life is the life the Collector is told', async () => {
  process.env.STORAGE_PRESIGN_TTL_SECONDS = '900'
  const { presignUpload, ttl } = await import('../lib/storage')

  const url = new URL(await presignUpload('orgs/a/session-2.jsonl'))
  expect(url.searchParams.get('X-Amz-Expires')).toBe(String(ttl()))
})

test('a delete that S3 refuses per key is a failure, not a success', async () => {
  const { S3Client } = await import('@aws-sdk/client-s3')
  const { deleteObjects } = await import('../lib/storage')

  // `DeleteObjects` answers 200 with a per-key result, so the SDK does not
  // reject: a refused key arrives as an entry in `Errors`. Dropped, it would
  // let a sweep commit the row deletions while the transcripts — source code,
  // sometimes a credential — stayed in the bucket with nothing pointing at
  // them.
  const send = vi
    .spyOn(S3Client.prototype, 'send')
    .mockResolvedValue({
      Errors: [{ Key: 'orgs/a/one.jsonl', Code: 'AccessDenied' }],
    } as never)

  await expect(deleteObjects(['orgs/a/one.jsonl'])).rejects.toThrow(
    /AccessDenied/,
  )

  // And a clean answer resolves, in one request per thousand keys rather than
  // one per object.
  send.mockResolvedValue({} as never)
  await deleteObjects(Array.from({ length: 1001 }, (_, n) => `orgs/a/${n}`))
  expect(send).toHaveBeenCalledTimes(3)

  send.mockRestore()
})
