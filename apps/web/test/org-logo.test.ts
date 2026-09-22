import { deflateSync } from 'node:zlib'

// oxlint-disable no-await-in-loop -- one database and one connection: the
// awaits in the loops below are a sequence on purpose, since each statement
// asserts what the one before it left behind.
import { beforeEach, expect, test } from 'vitest'

import {
  clearOrgLogo,
  MAX_LOGO_BYTES,
  MAX_LOGO_PIXELS,
  MIN_LOGO_PIXELS,
  orgLogo,
  orgLogoSrc,
  readLogo,
  setOrgLogo,
} from '../lib/org-logo'
import { invitationOrg, invite } from '../lib/invitations'
import {
  anonymous,
  asRole,
  owner as sql,
  seedFixture,
  type Fixture,
} from './harness'

// Ticket 77's fourth criterion: "An Owner or Admin uploads an Org logo, which
// appears in the signed-in nav, on sign-in, and in invite email, and which a
// Member cannot remove." The removal half is the one worth proving as SQL —
// the three surfaces are markup, the policies are not.

/** A PNG of the given size. Only the header is ever parsed, but the rest is
 * real so the fixture is a file a browser would also accept. */
const chunk = (type: string, body: Buffer) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.byteLength)
  const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body])
  // The CRC is not checked by anything here, and a wrong one would make the
  // fixture a file no browser accepts, so it is left zero and named.
  return Buffer.concat([length, tagged, Buffer.alloc(4)])
}

const png = (width: number, height: number) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(height * (1 + width * 4))
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

const jpeg = (width: number, height: number) => {
  const sof = Buffer.alloc(11)
  sof.writeUInt16BE(0xffc0, 0)
  sof.writeUInt16BE(9, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  // An APP0 segment in front of it, because that is where a real JPEG puts
  // one and a parser that assumed a fixed offset would pass without it. Its
  // declared length counts itself but not the marker: 16 bytes after `ff e0`.
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0'),
    Buffer.alloc(9),
  ])
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]))
}

const webp = (width: number, height: number) => {
  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'ascii')
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8 ', 12, 'ascii')
  buffer.writeUInt16LE(width, 26)
  buffer.writeUInt16LE(height, 28)
  return new Uint8Array(buffer)
}

test('a logo is read from its bytes, never from what was claimed', () => {
  for (const [name, bytes] of [
    ['PNG', png(200, 120)],
    ['JPEG', jpeg(200, 120)],
    ['WebP', webp(200, 120)],
  ] as const) {
    expect(readLogo(bytes), name).toEqual({
      logo: {
        contentType: `image/${name.toLowerCase() === 'jpeg' ? 'jpeg' : name.toLowerCase()}`,
        width: 200,
        height: 120,
      },
    })
  }
})

test('anything that is not one of the three formats is refused', () => {
  for (const bytes of [
    // An SVG, which is the one that matters: served from this origin it would
    // be a document with script in it.
    new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    new TextEncoder().encode('<!doctype html><script>alert(1)</script>'),
    new TextEncoder().encode('GIF89a'),
    new Uint8Array(0),
  ]) {
    expect(readLogo(bytes)).toEqual({ refusal: 'not_an_image' })
  }
})

test('a PNG whose first chunk is not IHDR is not an image', () => {
  // The dimensions are read from a fixed offset because IHDR must come first.
  // A file that carries the signature and puts something else there would
  // otherwise be measured from whatever those bytes happen to say.
  const real = png(200, 120)
  const forged = new Uint8Array(real)
  forged.set(new TextEncoder().encode('tEXt'), 12)
  expect(readLogo(forged)).toEqual({ refusal: 'not_an_image' })
})

test('fill bytes between JPEG segments are padding, not a refusal', () => {
  // `ff` repeated before a marker is legal, and a walk that treated it as the
  // marker refused valid files.
  const real = jpeg(200, 120)
  const padded = new Uint8Array(real.byteLength + 3)
  padded.set(real.subarray(0, 2))
  padded.set([0xff, 0xff, 0xff], 2)
  padded.set(real.subarray(2), 5)
  expect(readLogo(padded)).toEqual({
    logo: { contentType: 'image/jpeg', width: 200, height: 120 },
  })
})

test('an image with more pixels than the table will hold is refused, not raised', () => {
  // A flat 10000x10000 PNG compresses to a few kB, so the byte bound lets it
  // through and `org_logos_dimensions_check` would then raise a check
  // violation out of the server action.
  expect(readLogo(png(MAX_LOGO_PIXELS + 1, 200))).toEqual({
    refusal: 'too_many_pixels',
  })
  expect(readLogo(png(200, MAX_LOGO_PIXELS + 1))).toEqual({
    refusal: 'too_many_pixels',
  })
})

test('a logo too small to draw, and a file too large to send, are refused', () => {
  expect(readLogo(png(MIN_LOGO_PIXELS - 1, 200))).toEqual({
    refusal: 'too_small',
  })
  expect(readLogo(png(200, MIN_LOGO_PIXELS - 1))).toEqual({
    refusal: 'too_small',
  })
  expect(readLogo(png(MIN_LOGO_PIXELS, MIN_LOGO_PIXELS))).toHaveProperty('logo')

  const huge = new Uint8Array(MAX_LOGO_BYTES + 1)
  huge.set(png(200, 200))
  expect(readLogo(huge)).toEqual({ refusal: 'too_large' })
})

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const upload = (
  role: 'owner' | 'admin' | 'manager' | 'member',
  orgId: string,
) =>
  asRole(fixture[orgId === fixture.acme.id ? 'acme' : 'globex'], role, (tx) =>
    setOrgLogo(tx, orgId, {
      contentType: 'image/png',
      width: 128,
      height: 128,
      bytes: png(128, 128),
    }),
  )

test('an Owner and an Admin set the logo, and nobody else does', async () => {
  for (const role of ['owner', 'admin'] as const) {
    expect(await upload(role, fixture.acme.id), role).toBe(true)
  }

  // Emptied first, deliberately: with a row present the same call is an
  // `on conflict do update` and exercises `org_logos_replace`. The insert is
  // the verb where a policy refusal raises instead of writing nothing, so it
  // is the one that has to be reached on its own.
  await sql`delete from org_logos`
  for (const role of ['manager', 'member'] as const) {
    expect(await upload(role, fixture.acme.id), role).toBe(false)
    expect(await sql`select count(*) from org_logos`).toEqual([{ count: '0' }])
  }
})

test('a Member cannot remove it, and an Admin can', async () => {
  await upload('owner', fixture.acme.id)

  for (const role of ['manager', 'member'] as const) {
    expect(
      await asRole(fixture.acme, role, (tx) =>
        clearOrgLogo(tx, fixture.acme.id),
      ),
      role,
    ).toBe(false)
    // Still there: a refusal that removed the row anyway would pass a test
    // that only checked the return value.
    expect(await sql`select count(*) from org_logos`).toEqual([{ count: '1' }])
  }

  expect(
    await asRole(fixture.acme, 'admin', (tx) =>
      clearOrgLogo(tx, fixture.acme.id),
    ),
  ).toBe(true)
  expect(await sql`select count(*) from org_logos`).toEqual([{ count: '0' }])
})

test('another Org’s Owner reaches neither the write nor the removal', async () => {
  await upload('owner', fixture.acme.id)

  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      setOrgLogo(tx, fixture.acme.id, {
        contentType: 'image/png',
        width: 128,
        height: 128,
        bytes: png(128, 128),
      }),
    ),
  ).toBe(false)
  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      clearOrgLogo(tx, fixture.acme.id),
    ),
  ).toBe(false)
})

test('the logo is readable with no session at all, which is what the email needs', async () => {
  await upload('owner', fixture.acme.id)

  // `org_logos_read` is `using (true)` on purpose: a mail client has no
  // session, and neither does somebody on the sign-in page.
  const logo = await anonymous((tx) => orgLogo(tx, fixture.acme.id))
  expect(logo?.content_type).toBe('image/png')
  expect(Buffer.from(logo!.bytes)).toEqual(Buffer.from(png(128, 128)))

  const src = await anonymous((tx) => orgLogoSrc(tx, fixture.acme.id))
  // Versioned, so the route can answer `immutable` without ever serving a
  // stale logo at the same URL.
  expect(src).toMatch(new RegExp(`^/api/org-logo/${fixture.acme.id}\\?v=\\d+$`))

  expect(await anonymous((tx) => orgLogoSrc(tx, fixture.globex.id))).toBeNull()
})

test('an invitation resolves to its Org for the sign-in page, until it does not', async () => {
  await upload('owner', fixture.acme.id)
  const { token } = await asRole(fixture.acme, 'owner', (tx) =>
    invite(
      tx,
      fixture.acme.id,
      'new@northwind.test',
      'member',
      fixture.acme.members.owner,
    ),
  )

  // Signed out, and in no Org: `invitations_read` refuses this person every
  // row, which is why the lookup is a `security definer` function and not a
  // select.
  const invited = await anonymous((tx) => invitationOrg(tx, token))
  expect(invited?.orgName).toBe(fixture.acme.name)
  expect(invited?.logo).toBeInstanceOf(Date)

  expect(await anonymous((tx) => invitationOrg(tx, 'not-a-token'))).toBeNull()

  // Revoked is the same answer as invented: the page shows no mark rather than
  // confirming that the Org exists and the link was once good.
  await asRole(
    fixture.acme,
    'owner',
    (tx) =>
      tx`update invitations set revoked_at = now() where org_id = ${fixture.acme.id}`,
  )
  expect(await anonymous((tx) => invitationOrg(tx, token))).toBeNull()
})
