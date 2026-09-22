# 96: Cloud environment setup through an API credential

**What to build:** Taha's finalised cloud setup (2026-09-22), shown the same way on the landing page, in the docs and in the dashboard's install panel.

1. The environment's setup script:

   ```bash
   claude plugin marketplace add NotTahaAli/sessclone
   claude plugin install sessclone --config url=https://sessclone.vercel.app --config api_key=sk_0000000000000000000000000000000000000000000
   ```

2. An API credential on the environment: name `SessClone`, allowed website `sessclone.vercel.app`, type Bearer, header `Authorization`, prefix `Bearer`, value the key ([Claude's docs](https://code.claude.com/docs/en/cloud-environments#add-api-credentials)).

The agent proxy replaces the `Authorization` header after a request leaves the container, so the real key is never in the setup script (readable by anyone using the environment) nor in the container. The placeholder has a key's shape only so the Collector's session-start check passes.

**Where the ask forks, and what was picked.**

- **Two tabs on the install panel, "Your machine" and "Cloud environment"** (Taha's pick, option a). The panel is on Costs' onboarding state and on Keys.
- **The URL and host come from this deployment's `NEXT_PUBLIC_APP_URL`**, so a self-hoster's panel names their own host, not `sessclone.vercel.app`.
- **The old environment-variable route is dropped from the docs** (Taha's pick, option a). It still works in code.
- **Claude offers API credentials on Pro and Max plans only**, not yet on Team or Enterprise. The panel says so.

**Blocked by:** 66, 69.

**Status:** done

- [x] `CLOUD_PLACEHOLDER_KEY` in `apps/web/lib/install-command.ts`, with a test that the Collector's own check accepts it
- [x] Dashboard install panel: a Cloud environment tab with the setup script and the credential's fields
- [x] New-key form points a cloud user at the credential rather than the command
- [x] `docs/install.md` cloud section rewritten to the setup script plus the credential
- [x] Landing page: install commands as shell commands, and the cloud FAQ names the credential
- [ ] Looked at on production by Taha
