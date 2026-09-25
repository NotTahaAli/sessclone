import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'

import type { FullConfig } from '@playwright/test'
import postgres from 'postgres'

import { AUTH_URL, BASE_URL, OWNER_URL, STATE } from '../playwright.config'

// Once per run: a fresh schema, the seed, and a signed-in session.
//
// Sign-in is Supabase's, and the app asks it one thing: `getClaims()`, which
// verifies an asymmetric JWT against `<url>/auth/v1/.well-known/jwks.json`
// (auth-js 2.116.0, `GoTrueClient.getClaims` and `fetchJwk`). So this serves
// that one path from a key made here, and writes the session cookie
// `@supabase/ssr` 0.12.7 reads: `sb-<first host label>-auth-token`, holding
// `base64-` and the base64url of the session JSON (one chunk under 3180
// characters). No magic link, no GoTrue, and the key never leaves this run.

const PERSON = {
  id: '00000000-0000-4000-8000-000000000135',
  email: 'e2e@sessclone.test',
}

const b64url = (value: string | Buffer) =>
  Buffer.from(value).toString('base64url')

export default async function globalSetup(config: FullConfig) {
  const root = dirname(config.configFile!)

  // `test/harness.ts`'s `applyMigrations`, which cannot be imported from
  // here: it reads `import.meta`, and this package is not an ES module. The
  // same refusal, because the drop is unrecoverable.
  const database = new URL(OWNER_URL).pathname.slice(1)
  if (!database.endsWith('_test')) {
    throw new Error(`refusing to reset ${database}: not a _test database`)
  }
  const owner = postgres(OWNER_URL)
  await owner.unsafe(
    'set client_min_messages = warning; drop schema public cascade; create schema public',
  )
  const migrations = join(root, '../../supabase/migrations')
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .toSorted()) {
    // oxlint-disable-next-line no-await-in-loop -- migrations apply in order.
    await owner.unsafe(readFileSync(join(migrations, file), 'utf8'))
  }

  // Alpha, the person's own and approved; Bravo, which has invited them.
  await owner`
    with tier as (select id from tiers where key = 'team'),
    person as (
      insert into users (id, email) values (${PERSON.id}, ${PERSON.email})
      returning id
    ),
    inviter as (
      insert into users (email) values ('owner@bravo.test') returning id
    ),
    alpha as (insert into orgs (name) values ('Alpha') returning id),
    bravo as (insert into orgs (name) values ('Bravo') returning id),
    joined as (
      insert into members (org_id, user_id, role)
      select alpha.id, person.id, 'owner'::member_role from alpha, person
      union all
      select bravo.id, inviter.id, 'owner' from bravo, inviter
      returning id, org_id, user_id
    ),
    approved as (
      insert into subscriptions (org_id, tier_id, status)
      select org.id, tier.id, 'active'
        from (select id from alpha union all select id from bravo) org, tier
    )
    insert into invitations (org_id, email, role, token_hash, expires_at, invited_by)
    select bravo.id, ${PERSON.email}, 'member', ${randomBytes(32).toString('hex')},
           now() + interval '7 days', joined.id
      from bravo join joined on joined.org_id = bravo.id
  `
  await owner.end()

  // The key, and the one endpoint of Supabase Auth the app calls.
  const kid = randomUUID()
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const jwks = JSON.stringify({
    keys: [
      { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' },
    ],
  })
  const server = createServer((request, response) => {
    const found = request.url === '/auth/v1/.well-known/jwks.json'
    response.writeHead(found ? 200 : 404, {
      'content-type': 'application/json',
    })
    response.end(found ? jwks : '{}')
  })
  const { hostname, port } = new URL(AUTH_URL)
  await new Promise<void>((resolve) =>
    server.listen(Number(port), hostname, resolve),
  )

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 4 * 3600
  const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }))
  const body = b64url(
    JSON.stringify({
      sub: PERSON.id,
      email: PERSON.email,
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      exp: expiresAt,
    }),
  )
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  const session = {
    access_token: `${head}.${body}.${b64url(signature)}`,
    refresh_token: 'e2e',
    token_type: 'bearer',
    expires_in: expiresAt - now,
    expires_at: expiresAt,
    user: { id: PERSON.id, email: PERSON.email, aud: 'authenticated' },
  }

  const state = join(root, STATE)
  mkdirSync(dirname(state), { recursive: true })
  writeFileSync(
    state,
    JSON.stringify({
      cookies: [
        {
          name: `sb-${hostname.split('.')[0]}-auth-token`,
          value: `base64-${b64url(JSON.stringify(session))}`,
          domain: new URL(BASE_URL).hostname,
          path: '/',
          expires: expiresAt,
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  )

  // Returned, so Playwright runs it as the teardown.
  return () => new Promise<void>((resolve) => server.close(() => resolve()))
}
