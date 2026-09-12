# 30: Identity normalisation

**What to build:** Stable Device and Project keys, so one repository is one Project however each machine cloned it, and a cloud environment is one Device rather than a new one per container.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Both spellings of one git remote normalise to the same Project key
- [ ] Credentials and the git suffix stripped; raw remote retained for debugging
- [ ] A non-repository directory keys distinctly per machine, never by bare directory name
- [ ] Local Devices keyed by machine; a cloud environment keyed by account, not container
- [ ] Device keys scoped per Member, so two Members may share a machine name
