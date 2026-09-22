import { SMTPServer } from 'smtp-server'

import { afterEach, expect, test, vi } from 'vitest'

import { renderInvite, sendInviteEmail } from '../lib/mailer'
import { deliveryLine } from '../app/(dashboard)/settings/org/members/invite-form'

// Ticket 82: the invitation email, verified against a real SMTP server rather
// than a mocked transport. `smtp-server` (the nodemailer project's own) stands
// up a listener on a random port; the mailer connects to it as it would to any
// deployment's SMTP, and the test reads back exactly what arrived.

/** One received message: the envelope the server saw and the raw data. */
type Received = { from: string; to: string[]; data: string }

let server: SMTPServer
let port: number
let received: Received[]

const listen = (options: ConstructorParameters<typeof SMTPServer>[0] = {}) =>
  new Promise<void>((resolve) => {
    received = []
    server = new SMTPServer({
      // No TLS and no auth: this is a loopback double, and `smtp://` with no
      // credentials is what the mailer sends when the URL carries none.
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData(stream, _session, callback) {
        const chunks: Buffer[] = []
        stream.on('data', (chunk) => chunks.push(chunk))
        stream.on('end', () => {
          received.push({
            from: _session.envelope.mailFrom
              ? _session.envelope.mailFrom.address
              : '',
            to: _session.envelope.rcptTo.map((r) => r.address),
            data: Buffer.concat(chunks).toString('utf8'),
          })
          callback()
        })
      },
      ...options,
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.server.address()
      port = typeof address === 'object' && address ? address.port : 0
      resolve()
    })
  })

const close = () =>
  new Promise<void>((resolve) => {
    server.close(() => resolve())
  })

afterEach(async () => {
  vi.unstubAllEnvs()
  if (server) await close()
})

const invite = {
  to: 'newcomer@example.com',
  link: 'https://sessclone.example.com/join/tok-123',
  orgName: 'Acme',
  invitedByEmail: 'owner@acme.test',
}

test('with either variable unset, nothing is sent and it says so', async () => {
  vi.stubEnv('SMTP_URL', '')
  vi.stubEnv('SMTP_FROM', '')
  expect(await sendInviteEmail(invite)).toBe('not-configured')

  // A URL with no From is a mailer that cannot address a message: unconfigured,
  // not half-configured.
  vi.stubEnv('SMTP_URL', 'smtp://127.0.0.1:2525')
  vi.stubEnv('SMTP_FROM', '')
  expect(await sendInviteEmail(invite)).toBe('not-configured')
})

test('a malformed SMTP_URL is a failed delivery, never a throw', async () => {
  // `createTransport` throws synchronously on a bad URL — a self-host typo, not
  // an exceptional case. It must be caught: the invitation is already created,
  // and letting it escape would orphan it and hide the link.
  vi.stubEnv('SMTP_FROM', 'sessclone <no-reply@example.com>')
  for (const bad of [
    'smtp.example.com:587',
    'smtp://u:p@h:notaport',
    'garbage',
  ]) {
    vi.stubEnv('SMTP_URL', bad)
    // eslint-disable-next-line no-await-in-loop -- each asserts one bad URL in turn
    expect(await sendInviteEmail(invite)).toBe('failed')
  }
})

test('deliveryLine names the outcome and always points at the link', () => {
  expect(deliveryLine('sent', 'a@b.test')).toContain('emailed to a@b.test')
  expect(deliveryLine('not-configured', 'a@b.test')).toContain(
    'does not send email',
  )
  expect(deliveryLine('failed', 'a@b.test')).toContain('could not be sent')
  // Every case tells the inviter they can send the link themselves.
  for (const d of ['sent', 'not-configured', 'failed'] as const) {
    expect(deliveryLine(d, 'a@b.test').toLowerCase()).toContain('link')
  }
})

test('the invitation is delivered to a real SMTP server, carrying the link', async () => {
  await listen()
  vi.stubEnv('SMTP_URL', `smtp://127.0.0.1:${port}`)
  vi.stubEnv('SMTP_FROM', 'sessclone <no-reply@example.com>')

  expect(await sendInviteEmail(invite)).toBe('sent')

  expect(received).toHaveLength(1)
  const [message] = received
  expect(message!.from).toBe('no-reply@example.com')
  expect(message!.to).toEqual(['newcomer@example.com'])
  // The link, the Org and the inviter are all in the body the server received.
  expect(message!.data).toContain('https://sessclone.example.com/join/tok-123')
  expect(message!.data).toContain('Acme')
  expect(message!.data).toContain('owner@acme.test')
})

test('a server that refuses the message is reported as failed, not thrown', async () => {
  // The invite is already created and its link returned, so a mail failure is
  // a sentence beside the link, never a 500 or a lost invitation.
  await listen({
    onData(_stream, _session, callback) {
      _stream.on('data', () => {})
      _stream.on('end', () => callback(new Error('nope')))
    },
  })
  vi.stubEnv('SMTP_URL', `smtp://127.0.0.1:${port}`)
  vi.stubEnv('SMTP_FROM', 'sessclone <no-reply@example.com>')

  expect(await sendInviteEmail(invite)).toBe('failed')
})

test('an unreachable server is reported as failed', async () => {
  // Nothing listens on this port.
  vi.stubEnv('SMTP_URL', 'smtp://127.0.0.1:1')
  vi.stubEnv('SMTP_FROM', 'sessclone <no-reply@example.com>')

  expect(await sendInviteEmail(invite)).toBe('failed')
})

test('the Org name is escaped in the HTML part but left raw in text', () => {
  // The HTML body is the injection sink; the text body is not, so only the
  // former escapes. Asserted on the rendered parts rather than the MIME, which
  // quoted-printable-wraps and would carry the raw tag in the text/plain part
  // legitimately.
  const message = renderInvite({
    ...invite,
    orgName: 'Acme <script>alert(1)</script>',
  })
  expect(message.html).toContain('Acme &lt;script&gt;alert(1)&lt;/script&gt;')
  expect(message.html).not.toContain('<script>alert(1)</script>')
  expect(message.text).toContain('Acme <script>alert(1)</script>')
})
