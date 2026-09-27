# 143: Plugin ready for Claude's plugin directory, and a faster setup

**What to build:** Taha, 2026-09-27: make the Collector plugin pass Claude's plugin directory checks (the developer portal's **Validate** and the security scan after submitting, per the plugin pre-submission checklist) and make setup fast and simple. Taha submits in the portal himself.

**What was decided (Taha, 2026-09-27).**

- Keep the plugin in this repository's `packages/plugin`. The portal holds hooks that run `node` files from a subfolder for a human reviewer ("Scripts the validator couldn't follow"); that hold is accepted rather than moving the plugin to its own repository.
- The API key comes only from the plugin's setup prompt. `SESSCLONE_API_KEY` is gone: the portal holds a plugin that reads a credential from the user's environment. `SESSCLONE_URL` stays.
- The key is optional. With none, requests carry no `Authorization` header and a cloud environment's proxy adds the SessClone credential, so the cloud setup script has no placeholder key (checked 2026-09-27: a POST to sessclone.com with no header from a cloud container got past auth).
- The URL defaults to `https://sessclone.com`, so the hosted install asks only for the key.
- Session start says "connected: reporting to <Org>" once per key and deployment, and "not connected" every session while the key is missing or refused, from the new `GET /api/ingest`.
- Two commands: `/sessclone:status` and `/sessclone:sync` (plugin commands are always namespaced).
- Released as 0.4.0.

**Blocked by:** none

**Status:** done

- [x] Plugin README of what it sends, where, and what it runs
- [x] Key only from `userConfig`, optional; URL defaults to the hosted service
- [x] `GET /api/ingest` key check, and the session-start line
- [x] `/sessclone:status`, `/sessclone:sync`
- [x] Docs, dashboard cloud setup, CHANGELOG 0.4.0
- [ ] Taha: Validate and submit in the developer portal (claude.ai/directory/manage), after the release is tagged
