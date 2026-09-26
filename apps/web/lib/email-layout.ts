// The one look every email SessClone sends shares (Direction A, "Log"): the
// app's invitation and sign-up notice (`lib/mailer.ts`) and the Supabase Auth
// templates committed under `supabase/templates/` (`test/email-templates.test.ts`
// renders those from this file, so the two cannot drift apart).
//
// Mail clients are not browsers, so the rules differ from `globals.css`:
// - Every style is inline. Clients that strip `<style>` still get the light
//   design; the `<style>` block only adds dark mode, for the clients that
//   honour `prefers-color-scheme` (Apple Mail, iOS Mail). Gmail ignores it and
//   inverts colours on its own.
// - Layout is tables, because Outlook's renderer knows nothing else.
// - No images. The mark is a text Σ with an accent underline, so nothing is
//   fetched from this deployment when a message is opened, and nothing is
//   blocked. The one exception is an Org's own logo, which the caller opts in
//   to (see `InviteEmail.logoUrl`).
// - System fonts: Geist is not something a mail client has.
//
// Colours are the light and dark tokens from `globals.css`, copied rather
// than imported because CSS variables do not survive a mail client.

const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace`

const LIGHT = {
  ground: '#faf9f5',
  rule: '#e5e2d9',
  text: '#141413',
  secondary: '#4d4c48',
  muted: '#69675f',
  accent: '#da7453',
  onAccent: '#390b00',
  accentText: '#9b4427',
}
const DARK = {
  ground: '#1f1e1d',
  rule: '#34332f',
  text: '#f0eee6',
  secondary: '#c2c0b6',
  muted: '#a3a19a',
  accentText: '#ffb59e',
}

/** Row data, addresses and Org names are interpolated into HTML, so every
 * value is escaped rather than trusted. Go-template placeholders such as
 * `{{ .ConfirmationURL }}` contain none of these characters and pass through. */
export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

export type EmailLayout = {
  /** The page title and the line most clients show beside the subject. */
  title: string
  heading: string
  /** One or two sentences under the heading. Already-escaped HTML. */
  intro: string
  /** The one action, as a button; its href is repeated below it as text to
   * paste, for clients that break buttons. */
  action?: { label: string; href: string }
  /** A one-time code shown large, for templates that carry one instead of a
   * link. Already-escaped. */
  code?: string
  /** Label and value rows under the action, values in mono. Plain text. */
  rows?: [string, string][]
  /** Muted closing lines. Already-escaped HTML. */
  notes?: string[]
  /** An absolute image URL beside the heading, or nothing. */
  logoUrl?: string | null
}

/** One row of the outer table. `cls` names the dark-mode colour class. */
const cell = (style: string, content: string, cls = '') =>
  `<tr><td${cls ? ` class="${cls}"` : ''} style="${style}">${content}</td></tr>`

const rule = `border-top:1px solid ${LIGHT.rule}`

export const renderLayout = ({
  title,
  heading,
  intro,
  action,
  code,
  rows = [],
  notes = [],
  logoUrl,
}: EmailLayout) => {
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="" width="24" height="24" style="vertical-align:-4px;border-radius:2px;margin-right:8px">`
    : ''

  const body = [
    cell(
      'padding-bottom:28px',
      `<span class="t" style="font-family:${MONO};font-weight:700;font-size:18px;line-height:1;color:${LIGHT.text};display:inline-block;border-bottom:3px solid ${LIGHT.accent};padding:0 1px 1px">&Sigma;</span>` +
        `<span class="t" style="font-size:15px;font-weight:600;color:${LIGHT.text};vertical-align:top;margin-left:8px">SessClone</span>`,
    ),
    cell(
      `font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:${LIGHT.text};padding-bottom:8px`,
      logo + escapeHtml(heading),
      't',
    ),
    cell(
      `font-size:14px;line-height:1.5;color:${LIGHT.secondary};padding-bottom:22px`,
      intro,
      'x',
    ),
    action
      ? cell(
          'padding-bottom:26px',
          `<a href="${escapeHtml(action.href)}" style="display:inline-block;background:${LIGHT.accent};color:${LIGHT.onAccent};font-size:14px;font-weight:600;text-decoration:none;padding:11px 18px;border-radius:6px">${escapeHtml(action.label)}</a>`,
        )
      : '',
    code
      ? cell(
          `font-family:${MONO};font-size:28px;font-weight:600;letter-spacing:0.2em;color:${LIGHT.text};padding-bottom:26px`,
          code,
          't',
        )
      : '',
    rows.length
      ? cell(
          '',
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
            rows
              .map(
                ([label, value]) =>
                  `<tr><td class="m r" style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${LIGHT.muted};padding:9px 12px 9px 0;${rule};width:34%;vertical-align:top">${escapeHtml(label)}</td>` +
                  `<td class="t r" style="font-family:${MONO};font-size:13px;color:${LIGHT.text};padding:9px 0;${rule};word-break:break-word">${escapeHtml(value)}</td></tr>`,
              )
              .join('') +
            `<tr><td colspan="2" class="r" style="${rule}"></td></tr></table>`,
        )
      : '',
    action
      ? cell(
          `font-size:12px;line-height:1.5;color:${LIGHT.muted};padding-top:22px`,
          `Button not working? Paste this into your browser:<br><span class="a" style="font-family:${MONO};color:${LIGHT.accentText};word-break:break-all">${escapeHtml(action.href)}</span>`,
          'm',
        )
      : '',
    ...notes.map((note) =>
      cell(
        `font-size:12px;line-height:1.5;color:${LIGHT.muted};padding-top:18px`,
        note,
        'm',
      ),
    ),
    cell(
      `font-family:${MONO};font-size:11px;color:${LIGHT.muted};padding-top:28px`,
      'sessclone.com',
      'm',
    ),
  ]

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>@media (prefers-color-scheme:dark){body,.g{background:${DARK.ground}!important}.t{color:${DARK.text}!important}.x{color:${DARK.secondary}!important}.m{color:${DARK.muted}!important}.r{border-color:${DARK.rule}!important}.a{color:${DARK.accentText}!important}}</style>`,
    '</head>',
    `<body style="margin:0;padding:0;background:${LIGHT.ground}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="g" style="background:${LIGHT.ground}"><tr><td style="padding:32px 20px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;font-family:${SANS}">`,
    ...body.filter(Boolean),
    '</table>',
    '</td></tr></table>',
    '</body>',
    '</html>',
  ].join('\n')
}
