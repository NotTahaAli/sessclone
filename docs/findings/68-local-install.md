# 68 — Manual verification: local install

A fresh install on a real macOS, a real Linux and a real Windows machine, each
running real Claude Code. Nothing here can be automated: automating it would
mean automating Claude Code.

What **is** automated is the reading. `node scripts/verify-collector.mjs`
gathers everything the checkboxes below ask about — the Node version, the
resolved state directory, the cursor and queue files as they actually landed,
the Device key, and the transcripts on disk — and prints it as a block to paste
into this file. The operator's part is: install, restart, work one ordinary
session, run the command.

## Per machine

```
/plugin marketplace add NotTahaAli/sessclone
/plugin install sessclone@sessclone
export SESSCLONE_API_KEY=sk_…
export SESSCLONE_URL=https://…
# restart Claude Code, then one ordinary session, then:
node scripts/verify-collector.mjs
```

The script prints the key's first three characters and its length, never more
(`keyEvidence`), because the output is pasted into a chat and a hook's stderr
lands in a transcript this product uploads.

Run it from a clone, or from the plugin's own checkout — the plugin installs
the whole repository, so `<config dir>/plugins/**/sessclone*/scripts` holds a
copy with the modules it imports beside it.

## Results

| Machine | OS  | Claude Code | Node | Turns arrived | State directory as resolved |
| ------- | --- | ----------- | ---- | ------------- | --------------------------- |
| macOS   |     |             |      |               |                             |
| Linux   |     |             |      |               |                             |
| Windows |     |             |      |               |                             |

**Windows is the one with no prior evidence.** Finding 06 has the config
directory and the transcript layout observed on a real Windows box, and the
Collector's own state directory confirmed writable by its operator — but no
Collector has ever run there. Record whether it was native Windows or WSL: they
resolve different state directories (`%LOCALAPPDATA%\sessclone` against
`~/.local/state/sessclone`), and a report that says only "Windows" does not say
which of the two was exercised.

### Paste per machine

<!-- One `## macOS`, `## Linux`, `## Windows` section, each holding the block
     the command printed, and a sentence on anything that surprised the
     operator. -->

## What the documentation failed to warn about

<!-- The last checkbox, and the one worth the exercise. Anything the operator
     had to work out that `docs/install.md` should have said. -->
