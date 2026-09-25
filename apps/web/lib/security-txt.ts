import { canonical, contactEmail } from './site'

// RFC 9116: where to report a vulnerability, at `/.well-known/security.txt`.
// Contact and Expires are the two required fields. Expires is computed from
// the request time, a year ahead (the RFC's upper bound), so the file never
// lapses the way a hand-edited one does.

const REPOSITORY = 'https://github.com/NotTahaAli/sessclone'
const YEAR_MS = 365 * 24 * 60 * 60 * 1000

export const securityTxt = (now: Date, email = contactEmail()) =>
  [
    // Private advisories first: SECURITY.md asks for reports there. The
    // operator's address only when this deployment has one, so a
    // self-hosted copy never lists somebody else's inbox.
    `Contact: ${REPOSITORY}/security/advisories/new`,
    ...(email ? [`Contact: mailto:${email}`] : []),
    `Expires: ${new Date(now.getTime() + YEAR_MS).toISOString()}`,
    `Policy: ${REPOSITORY}/blob/main/SECURITY.md`,
    `Canonical: ${canonical('/.well-known/security.txt')}`,
    'Preferred-Languages: en',
    '',
  ].join('\n')
