import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

// Claude Code updates a plugin only when its `version` changes: with the same
// string, `/plugin update` says it is already at the latest version and keeps
// the cached copy. `plugin.json` sat at `0.0.0` through 0.1.0, so no install
// ever took an update (Taha, 2026-09-25). The version follows the release, so
// cutting a CHANGELOG section without bumping it fails here.

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

it("carries the latest release's version, so installs update", async () => {
  const [manifest, changelog] = await Promise.all([
    read('../.claude-plugin/plugin.json'),
    read('../../../CHANGELOG.md'),
  ])
  const latest = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1]

  expect(latest).toBeDefined()
  expect(JSON.parse(manifest).version).toBe(latest)
})
