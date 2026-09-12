# 32: Collector configuration

**What to build:** The one setup step a Member performs per machine: give the Collector a key and a server to report to.

**Blocked by:** 15, 28.

**Status:** ready-for-agent

- [ ] API key read from plugin configuration on every supported environment
- [ ] Server base URL configurable, so a self-hoster's team reports to their own deployment
- [ ] A missing or malformed key fails loudly at setup rather than silently at report time
- [ ] The key is never written to a log or a transcript
