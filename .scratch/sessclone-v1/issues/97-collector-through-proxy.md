# 97: The Collector goes through the proxy, and a refused key says so

**What to build:** Found on 2026-09-22 in a Claude Projects container ("Is the collector running here" thread), handed to this ticket by Taha. A cloud environment set up per ticket 96 collected nothing: Node's `fetch` ignores `HTTPS_PROXY`, so the Collector connected directly, the agent proxy never added the SessClone API credential, and ingest answered `401` to the placeholder key. `curl` in the same container went through the proxy and authenticated. With `NODE_USE_ENV_PROXY=1` the same report was answered 200.

Worse, it was invisible. A 4xx is final, so a refused report writes no cursor and queues nothing, and `~/.local/state/sessclone` was never even created: a Collector refused on every report looked exactly like one that was never installed.

**Where the ask forks, and what was picked.**

- **Restart the hook with `NODE_USE_ENV_PROXY=1` when `HTTPS_PROXY` is set.** Node reads the switch only at startup, and no public API turns it on later in Node 22. The alternative, a hand-written CONNECT tunnel over `node:https`, is more code at every call site. The cost is one extra Node start per hook where a proxy is set.
- **Feature-tested by `process.allowedNodeEnvironmentFlags.has('--use-env-proxy')`,** not by version, so a Node without it (below 22.21) connects directly as before rather than restarting for nothing.
- **The experimental-agent warning is suppressed** (`--disable-warning=UNDICI-EHPA`), because a hook's stderr lands in the uploaded transcript.
- **`<state dir>/last-answer.json`**: status and time of the last report, never the key. `verify-collector.mjs` prints it; the session start after a `401` prints one line naming the key and, for cloud, the credential and the proxy.
- **`NODE_USE_ENV_PROXY=1` in the environment settings stays harmless** once this ships. It is no longer a documented step.

**Blocked by:** 96.

**Status:** done

- [x] `packages/plugin/src/proxy.mjs`, called first in all four hooks; tested that the restarted hook gets the switch, stdin unread, and its own exit status
- [x] Checked live from a cloud container: the same POST to ingest went from 401 direct to 400 (key accepted, empty body refused) through the restart
- [x] `last-answer.json` written by every report, including an unreachable one
- [x] Session start prints the refusal (only one from this sweep, so a fixed key is not blamed); the install check prints the last answer
- [x] `verify-collector.mjs` probes `/api/ingest` with the key through the same route the hooks take, and prints whether a proxy is set and used. It used to GET the base URL, which answered 200 while ingest refused every report
- [x] `docs/configuration.md` and `docs/install.md` updated
- [ ] A fresh cloud container reports Turns with only the setup script and the credential, seen on production by Taha
