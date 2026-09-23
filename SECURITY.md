# Security

## Supported versions

| What                                | Supported              |
| ----------------------------------- | ---------------------- |
| `main`                              | yes                    |
| The latest tagged release           | yes                    |
| Older releases                      | no — upgrade first     |
| The hosted service at sessclone.com | yes, always the latest |

There are no tagged releases yet; until the first one, `main` is the only
supported version.

## Reporting a vulnerability

Report it privately through GitHub:
**<https://github.com/NotTahaAli/sessclone/security/advisories/new>**

If you cannot use GitHub, email **hello@sessclone.com** with a subject starting
`[security]`. Please do not open a public issue, pull request or discussion for
a vulnerability.

### What to include

- What the problem is and what an attacker gains from it.
- Where it lives: the hosted service, the Collector plugin, or the self-hosted
  code, and the commit or release you tested.
- Steps to reproduce, or a proof of concept, as small as you can make it.
- Anything you already know about a fix.

**Never attach a real transcript.** Claude Code transcripts carry source code
and, often enough, credentials — API keys, tokens, `.env` contents that passed
through a tool call. Build a synthetic one that shows the problem, and redact
API keys from any log you send.

## What to expect

SessClone has one maintainer, so these are goals rather than guarantees:

- An acknowledgement within 7 days.
- An assessment, and a rough plan if it is a real issue, soon after.
- Credit in the advisory once a fix ships, unless you would rather not be
  named.

Please give a reasonable window to fix it before you disclose publicly. We will
agree a date with you rather than go quiet.

## Scope

In scope:

- The hosted service at sessclone.com.
- The Collector plugin (`packages/plugin`).
- The self-hosted code in this repository: the web app, the ingest routes, the
  database migrations and their RLS policies.

Out of scope:

- Vulnerabilities in Supabase, Vercel or other third-party platforms
  themselves. Report those to the vendor. A misconfiguration of them that this
  repository ships is in scope.
- Social engineering of the maintainer or of users.
- Denial of service, including volumetric attacks and load testing against
  the hosted service.

## Safe harbour

We will not pursue legal action against research done in good faith under this
policy: stay within scope, use only accounts and data you own, do not degrade
the hosted service, and report what you find to us before anyone else.
