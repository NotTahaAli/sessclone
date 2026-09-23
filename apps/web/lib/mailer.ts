import { createTransport } from 'nodemailer'

// Ticket 82: the invitation, delivered.
//
// Ticket 49 builds the invitation and hands the inviter a link to pass on,
// because this deployment has no outbound mail of its own — Supabase Auth mails
// sign-in links, but an invitation is the app's own `/join/<token>` route and
// Supabase never sees it. This file is the app's own SMTP, used for that one
// email and reported as absent rather than failing quietly when it is not set.
//
// Two variables, both optional. `SMTP_URL` is a connection URL nodemailer
// parses — `smtp://user:pass@host:587` (STARTTLS when the server offers it) or
// `smtps://…@host:465` (TLS from the first byte) — so the host, port, auth and
// transport security are one value a self-hoster copies from their provider
// rather than five this file would have to define a shape for. `SMTP_FROM` is
// the From address. Neither has a default: mail that is not configured is a
// link the inviter copies, which is worse to fake than to admit.
//
// The credentials live in `SMTP_URL` and never reach the browser: this module
// is server-only (no `NEXT_PUBLIC_`), imported by a Server Action, and the URL
// is passed to nodemailer and put in no log line and no rendered page.

/** Present only when both variables are set: a URL with no From is a mailer
 * that cannot address a message, so it is treated as unconfigured, not as a
 * half-configured one that fails at send time. */
type MailerConfig = { url: string; from: string }

const mailerConfig = (): MailerConfig | null => {
  const url = process.env.SMTP_URL?.trim()
  const from = process.env.SMTP_FROM?.trim()
  return url && from ? { url, from } : null
}

/**
 * What one delivery attempt did:
 * - `sent`: the server accepted the message.
 * - `not-configured`: no SMTP is set, so nothing was attempted.
 * - `failed`: SMTP is set but the server refused or was unreachable.
 *
 * The link is shown by the caller in every case; delivery only decides what
 * sentence sits beside it.
 */
export type Delivery = 'sent' | 'not-configured' | 'failed'

export type InviteEmail = {
  to: string
  /** The absolute join URL — the same link the inviter can copy, not a second
   * token: one capability, one place it can be spent. */
  link: string
  orgName: string
  /** Who sent it, for the person deciding whether to trust the link. */
  invitedByEmail: string
  /**
   * The Org's logo, as an absolute URL, or nothing (ticket 77). Absolute
   * because a mail client has no origin to resolve a path against — and it is
   * the only image in the message, which is why it is 24px and beside the
   * name rather than a banner across the top.
   *
   * **It is a remote image, so fetching it reaches this deployment**: an
   * invitee whose mail client loads images discloses their IP address and the
   * moment they opened the message to whoever reads the web logs, for an
   * invitation they have not accepted. Named rather than hidden, because it
   * is the kind of thing a privacy notice has to be able to say. Most clients
   * block remote images by default and the message reads the same without it;
   * a deployment that would rather not offer the choice can leave the logo
   * unset.
   */
  logoUrl?: string | null
}

/** A subject and body that name the Org and the inviter and carry the link.
 * Plain text and a minimal HTML part with the link as the only interactive
 * element — an invitation is a link and a sentence, not a layout. Exported so
 * the escaping below is testable without parsing MIME back off the wire. */
export const renderInvite = ({
  to,
  link,
  orgName,
  invitedByEmail,
  logoUrl,
}: InviteEmail) => ({
  to,
  subject: `You are invited to ${orgName} on sessclone`,
  text: [
    `${invitedByEmail} invited you to join ${orgName} on sessclone.`,
    '',
    `Accept the invitation: ${link}`,
    '',
    'The link works once and expires. If you did not expect it, ignore this email.',
  ].join('\n'),
  html: [
    // Images are blocked by default in most mail clients, so the mark is
    // decoration with an empty `alt` and the sentence beside it says the Org's
    // name in text. A blocked logo leaves the invitation reading exactly as it
    // did before ticket 77.
    logoUrl
      ? `<p><img src="${escapeHtml(logoUrl)}" alt="" width="24" height="24" style="vertical-align:middle;border-radius:2px"></p>`
      : '',
    `<p>${escapeHtml(invitedByEmail)} invited you to join <strong>${escapeHtml(orgName)}</strong> on sessclone.</p>`,
    `<p><a href="${escapeHtml(link)}">Accept the invitation</a></p>`,
    `<p>The link works once and expires. If you did not expect it, ignore this email.</p>`,
  ]
    .filter(Boolean)
    .join('\n'),
})

/** The invitee address, the Org name and the inviter address are all data from
 * a row, and the body is HTML — so the three interpolated values are escaped
 * rather than trusted. The link is app-built (`invitePath` + `appUrl`), but
 * escaped too: it is cheaper than proving it can never contain a quote. */
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/**
 * Sends the invitation email, or reports why it could not.
 *
 * Never throws: the invite has already been created and its link returned, so
 * a mail failure must not undo that or surface as a 500. The transporter is
 * built per call rather than kept at module scope — an invitation is rare, a
 * pooled connection to an SMTP server the deployment may have mis-set is a
 * resource leak this does not need, and `nodemailer`'s default is to open and
 * close a connection per `sendMail`.
 */
export const sendInviteEmail = (email: InviteEmail): Promise<Delivery> =>
  deliver(renderInvite(email))

/** `true` when SMTP is set, so a caller can skip the work of building a
 * message nobody will send (ticket 120). */
export const mailerConfigured = () => mailerConfig() !== null

export type SignupNotice = {
  to: string[]
  orgName: string
  ownerEmail: string
  /** The Tier they asked for, or null when they asked for none. */
  tierName: string | null
  requestedSeats: number | null
  /** Where the operator approves it: the Org's admin page, absolute. */
  link: string
}

/** Ticket 120: the note to the platform admins that an Org is waiting.
 * Exported for the same reason `renderInvite` is. */
export const renderSignupNotice = ({
  to,
  orgName,
  ownerEmail,
  tierName,
  requestedSeats,
  link,
}: SignupNotice) => {
  const plan = tierName
    ? `${tierName}${requestedSeats ? `, ${requestedSeats} seats` : ''}`
    : 'no plan chosen'
  return {
    to,
    subject: `${orgName} is waiting for approval on sessclone`,
    text: [
      `${ownerEmail} signed up and created ${orgName} (${plan}).`,
      '',
      `Approve it or turn it down: ${link}`,
    ].join('\n'),
    html: [
      `<p>${escapeHtml(ownerEmail)} signed up and created <strong>${escapeHtml(orgName)}</strong> (${escapeHtml(plan)}).</p>`,
      `<p><a href="${escapeHtml(link)}">Approve it or turn it down</a></p>`,
    ].join('\n'),
  }
}

export const sendSignupNotice = (notice: SignupNotice): Promise<Delivery> =>
  notice.to.length === 0
    ? Promise.resolve('not-configured')
    : deliver(renderSignupNotice(notice))

/**
 * Sends one message, or reports why it could not.
 *
 * Never throws: an invitation has already been created and its link returned,
 * and a sign-up has already happened, so a mail failure must not undo either
 * or surface as a 500. The transporter is built per call rather than kept at
 * module scope — mail is rare, a pooled connection to an SMTP server the
 * deployment may have mis-set is a resource leak this does not need, and
 * `nodemailer`'s default is to open and close a connection per `sendMail`.
 */
const deliver = async (message: {
  to: string | string[]
  subject: string
  text: string
  html: string
}): Promise<Delivery> => {
  const config = mailerConfig()
  if (!config) return 'not-configured'

  try {
    // Inside the try on purpose: `createTransport` throws *synchronously* on a
    // malformed URL — a missing scheme, a non-numeric port — which is an
    // ordinary self-host typo, not an exceptional one. Building it outside
    // would let that throw escape and reject the action, orphaning the
    // invitation whose link the inviter never then sees. A bad URL is a
    // `failed` delivery like any other: the link is still shown to copy.
    const transporter = createTransport(config.url)
    try {
      await transporter.sendMail({ from: config.from, ...message })
      return 'sent'
    } finally {
      transporter.close()
    }
  } catch {
    // The reason is not surfaced: an SMTP error can echo the recipient and the
    // server's banner, and the inviter's remedy is the same whatever it was —
    // copy the link. The deployment's operator reads the cause in their own
    // mail server's logs, not in a page a Member sees.
    return 'failed'
  }
}
