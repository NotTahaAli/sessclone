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
  // `send` is overloaded, so its mock's parameter resolves to `void` and the
  // answer has to be asserted in. Test-only, and the assertion is what makes
  // the S3 answer shape explicit rather than hiding it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- overloaded signature, see above
  const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({
    Errors: [{ Key: 'orgs/a/one.jsonl', Code: 'AccessDenied' }],
  } as never)

  await expect(deleteObjects(['orgs/a/one.jsonl'])).rejects.toThrow(
    /AccessDenied/,
  )

  // And a clean answer resolves, in one request per thousand keys rather than
  // one per object.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
  send.mockResolvedValue({} as never)
  await deleteObjects(Array.from({ length: 1001 }, (_, n) => `orgs/a/${n}`))
  expect(send).toHaveBeenCalledTimes(3)

  send.mockRestore()
})

test('a hostile Session id cannot escape the download filename', async () => {
  const { presignDownload } = await import('../lib/storage')

  // Every character here has reached `log_artifacts.session_id`'s only check,
  // which is that it is not blank. The quote and the backslash would end the
  // quoted string, the CRLF would split the header, `%0d` is the same attempt
  // percent-encoded, and U+202E reverses what a person reads before they save.
  const url = new URL(
    await presignDownload(
      'orgs/a/session.jsonl',
      'se"ss\\ion\r\n%0d‮lsx.jsonl',
    ),
  )
  const disposition = url.searchParams.get('response-content-disposition')!

  expect(disposition).toBe(
    `attachment; filename="session%0dlsx.jsonl"; ` +
      `filename*=UTF-8''session%250dlsx.jsonl`,
  )
  // The percent-encoded attempt stays literal text: the signer encodes the
  // query value, so the provider hands back `%` and `0d` rather than a CR.
  expect(url.search).toContain('session%250dlsx.jsonl')

  // And the value is bounded, because it travels in a signed query string.
  const long = new URL(
    await presignDownload('orgs/a/session.jsonl', `${'x'.repeat(4000)}.jsonl`),
  )
  expect(long.searchParams.get('response-content-disposition')).toHaveLength(
    'attachment; filename=""; filename*=UTF-8\'\''.length + 400,
  )
})

// What Supabase Storage accepts in an object key, from its own refusal: a key
// carrying `%` is answered `InvalidKey` with a 400 — after the bytes have
// moved, since presign had already said yes. Observed against a real
// deployment on 2026-09-22, where every transcript upload failed this way and
// nothing in the product could say so.
const SUPABASE_KEY = /^[A-Za-z0-9/._-]+$/

test('a key carries no character a provider refuses', async () => {
  const { artifactKey } = await import('../lib/storage')

  const key = artifactKey({
    orgId: '69d07d8f-0959-46ad-97dc-d6a1bb9fd71f',
    memberId: 'e1dfc225-05e8-451d-b7fb-afe37abaeb4c',
    // The Project key that produced the failure: slashes, and a dot.
    projectKey: 'github.com/nottahaali/sessclone',
    sessionId: 'fe7a7700-cf66-4da1-87b1-723f1a40b3d0',
    agentId: null,
  })

  expect(key).not.toContain('%')
  expect(key).toMatch(SUPABASE_KEY)
  expect(key).toBe(
    'orgs/69d07d8f-0959-46ad-97dc-d6a1bb9fd71f/members/e1dfc225-05e8-451d-b7fb-afe37abaeb4c/projects/github.com-nottahaali-sessclone/fe7a7700-cf66-4da1-87b1-723f1a40b3d0.jsonl',
  )
})

test('an Agent Run is a file under its Session, and still a valid key', async () => {
  const { artifactKey } = await import('../lib/storage')

  const key = artifactKey({
    orgId: 'org',
    memberId: 'member',
    projectKey: 'local:/Users/someone/My Projects/api',
    sessionId: 'session-1',
    agentId: 'agent-1',
  })

  expect(key).toMatch(SUPABASE_KEY)
  expect(key).toContain('/projects/local-Users-someone-My-Projects-api/')
  expect(key.endsWith('/session-1/agents/agent-1.jsonl')).toBe(true)
})

test('a run’s sidecar and a workflow’s journal each have a key of their own', async () => {
  // Ticket 101: beside the transcript they describe, never on top of it.
  const { artifactKey } = await import('../lib/storage')
  const at = {
    orgId: 'org',
    memberId: 'member',
    projectKey: 'p',
    sessionId: 'session-1',
  }

  expect(artifactKey({ ...at, agentId: 'agent-1', kind: 'agent_meta' })).toBe(
    'orgs/org/members/member/projects/p/session-1/agents/agent-1.meta.json',
  )
  expect(
    artifactKey({ ...at, agentId: 'wf_3/../x', kind: 'workflow_journal' }),
  ).toBe(
    'orgs/org/members/member/projects/p/session-1/workflows/wf_3-..-x.journal.jsonl',
  )
  expect(artifactKey({ ...at, agentId: 'agent-1', kind: 'transcript' })).toBe(
    'orgs/org/members/member/projects/p/session-1/agents/agent-1.jsonl',
  )
})

test('nothing a Collector sends escapes its own segment', async () => {
  const { artifactKey } = await import('../lib/storage')

  const key = artifactKey({
    orgId: 'org',
    memberId: 'member',
    projectKey: '../../../etc',
    sessionId: '../../secrets',
    agentId: null,
  })

  // The traversal is transliterated, not honoured: one Project segment, one
  // Session file, both under this Member's prefix.
  expect(key).toBe('orgs/org/members/member/projects/etc/secrets.jsonl')
})

test('a Session outside any repository still has a segment of its own', async () => {
  const { artifactKey } = await import('../lib/storage')

  expect(
    artifactKey({
      orgId: 'org',
      memberId: 'member',
      projectKey: null,
      sessionId: 'session-1',
      agentId: null,
    }),
  ).toBe('orgs/org/members/member/projects/none/session-1.jsonl')
})
