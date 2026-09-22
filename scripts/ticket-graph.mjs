#!/usr/bin/env node
// Regenerates the ticket status graph from the ticket files themselves.
//
//   node scripts/ticket-graph.mjs            # rebuild spec, and HTML if archify is present
//   node scripts/ticket-graph.mjs --check    # fail if the committed spec is stale
//
// A ticket is done when its Status line says done or closed; ready when every
// ticket it is blocked by is done; blocked otherwise. Tickets roll up into the
// phases below, because 71 nodes is a wall chart, not a diagram.

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const issuesDir = join(repo, '.scratch/sessclone-v1/issues')
const specPath = join(repo, 'docs/tickets/ticket-graph.architecture.json')
const htmlPath = join(repo, 'docs/tickets/ticket-graph.html')
const archifyHome =
  process.env.ARCHIFY_HOME ||
  join(process.env.HOME || '', '.claude/skills/archify')

// id, label, lane, col, node type, and the ticket numbers the phase owns.
const PHASES = [
  {
    id: 'foundation',
    label: 'Foundation',
    type: 'backend',
    pos: [40, 298],
    range: [1, 2],
  },
  {
    id: 'design',
    label: 'Frontend Design',
    type: 'frontend',
    pos: [270, 70],
    range: [16, 20],
  },
  {
    id: 'spikes',
    label: 'Spikes + Fixtures',
    type: 'security',
    pos: [40, 578],
    range: [3, 8],
  },
  {
    id: 'decisions',
    label: 'Decisions',
    type: 'security',
    pos: [270, 578],
    range: [9, 15],
  },
  {
    id: 'schema',
    label: 'Schema + Harness',
    type: 'database',
    pos: [500, 332],
    range: [21, 25],
  },
  {
    id: 'accounts',
    label: 'Site + Accounts',
    type: 'frontend',
    pos: [730, 332],
    range: [26, 28],
  },
  {
    id: 'collection',
    label: 'Collection + Cost',
    type: 'backend',
    pos: [960, 122],
    range: [29, 43],
    // Ticket added after the ranges were drawn; see the note on `archival`.
    also: [81],
  },
  {
    id: 'product',
    label: 'Access + Dashboard',
    type: 'security',
    pos: [960, 560],
    range: [44, 57],
    also: [77, 78, 82],
  },
  {
    id: 'ship',
    label: 'Ship + Verify',
    type: 'external',
    pos: [1190, 122],
    range: [66, 71],
    also: [79],
  },
  {
    id: 'archival',
    label: 'Archival + Admin',
    type: 'cloud',
    pos: [1190, 560],
    range: [58, 65],
    // Tickets added after the ranges were drawn. The label still reads its
    // range, so keep this list short — a phase whose `also` outgrows its range
    // wants a new range, not a longer list.
    also: [72, 73, 80, 83, 84, 97],
  },
  {
    id: 'projects',
    label: 'Projects Source',
    type: 'cloud',
    pos: [1190, 341],
    range: [74, 76],
  },
  {
    id: 'drilldown',
    label: 'Sessions + Names',
    type: 'frontend',
    pos: [1190, 800],
    // 89 to 94 extend the same surfaces: what a Session spent per model, the
    // friendly names for a Project, a Session and a person, and the archiving,
    // hiding and searching that make a month of Sessions navigable.
    range: [85, 94],
  },
]

const phaseOf = (n) =>
  PHASES.find(
    (p) => (n >= p.range[0] && n <= p.range[1]) || p.also?.includes(n),
  )?.id

function readTickets() {
  const tickets = new Map()
  for (const file of readdirSync(issuesDir)
    .filter((f) => /^\d+-.*\.md$/.test(f))
    .toSorted()) {
    const body = readFileSync(join(issuesDir, file), 'utf8')
    const num = Number(file.slice(0, file.indexOf('-')))
    const title = body.match(/^#\s*\d+:\s*(.+)$/m)?.[1]?.trim() ?? file
    const status =
      body
        .match(/\*\*Status:\*\*\s*(.+)/)?.[1]
        ?.trim()
        .toLowerCase() ?? 'unknown'
    const blockedLine = body.match(/\*\*Blocked by:\*\*\s*(.+)/)?.[1] ?? ''
    const blockers = /none/i.test(blockedLine)
      ? []
      : [...blockedLine.matchAll(/\d+/g)].map((m) => Number(m[0]))
    tickets.set(num, {
      num,
      title,
      status,
      blockers,
      done: status === 'done' || status === 'closed',
    })
  }
  if (!tickets.size) throw new Error(`no tickets found in ${issuesDir}`)
  // A ticket outside every phase would vanish from the diagram and from its
  // counts, silently. Fail instead.
  const orphans = [...tickets.keys()].filter((n) => !phaseOf(n))
  if (orphans.length) {
    throw new Error(`tickets in no phase: ${orphans.join(', ')}`)
  }
  return tickets
}

function stateOf(ticket, tickets) {
  if (ticket.done) return 'done'
  return ticket.blockers.every((b) => tickets.get(b)?.done)
    ? 'ready'
    : 'blocked'
}

// Phase B depends on phase A when any ticket in B is blocked by one in A.
// Transitive edges are dropped so the diagram shows structure, not every path.
function phaseEdges(tickets) {
  const direct = new Set()
  for (const t of tickets.values()) {
    for (const b of t.blockers) {
      const from = phaseOf(b)
      const to = phaseOf(t.num)
      if (from && to && from !== to) direct.add(`${from}>${to}`)
    }
  }
  const adj = new Map(PHASES.map((p) => [p.id, new Set()]))
  for (const e of direct) {
    const [from, to] = e.split('>')
    adj.get(from).add(to)
  }
  const reaches = (from, to, skip, seen = new Set()) => {
    for (const next of adj.get(from) ?? []) {
      if (from === skip[0] && next === skip[1]) continue
      if (next === to) return true
      if (!seen.has(next)) {
        seen.add(next)
        if (reaches(next, to, skip, seen)) return true
      }
    }
    return false
  }
  return [...direct]
    .map((e) => e.split('>'))
    .filter(([from, to]) => !reaches(from, to, [from, to]))
}

function buildSpec(tickets) {
  const counts = (ids) => {
    const c = { done: 0, ready: 0, blocked: 0 }
    for (const n of ids) c[stateOf(tickets.get(n), tickets)]++
    return c
  }

  const components = PHASES.map((p) => {
    const ids = [...tickets.keys()].filter((n) => phaseOf(n) === p.id)
    const c = counts(ids)
    const parts = []
    if (c.done) parts.push(`${c.done} done`)
    if (c.ready) parts.push(`${c.ready} ready`)
    if (c.blocked) parts.push(`${c.blocked} blocked`)
    return {
      id: p.id,
      type: p.type,
      // The ticket range rides in the label, not the sublabel: three count
      // parts plus a range overflows the renderer's desktop-readability check.
      label: `${p.label} (${p.range[0]}-${p.range[1]})`,
      sublabel: parts.join(' \u00b7 '),
      pos: p.pos,
      size: [165, 68],
    }
  })

  const phaseState = (id) => {
    const ids = [...tickets.keys()].filter((n) => phaseOf(n) === id)
    const c = counts(ids)
    if (c.done === ids.length) return 'done'
    return c.ready > 0 ? 'ready' : 'blocked'
  }

  const connections = phaseEdges(tickets).map(([from, to]) => {
    const state = phaseState(to)
    return {
      id: `${from}_${to}`,
      from,
      to,
      variant:
        state === 'ready'
          ? 'emphasis'
          : state === 'blocked'
            ? 'dashed'
            : 'default',
    }
  })

  const totals = counts([...tickets.keys()])
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'sessclone v1 — ticket status',
      subtitle: `${tickets.size} tickets \u00b7 ${totals.done} done \u00b7 ${totals.ready} ready to start \u00b7 ${totals.blocked} blocked`,
      output: 'docs/tickets/ticket-graph.html',
      quality_profile: 'showcase',
    },
    components,
    connections,
  }
}

const tickets = readTickets()
const spec = JSON.stringify(buildSpec(tickets), null, 2) + '\n'
const check = process.argv.includes('--check')

if (check) {
  const current = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
  if (current !== spec) {
    console.error('ticket graph is stale — run: node scripts/ticket-graph.mjs')
    process.exit(1)
  }
  console.log('ticket graph is up to date')
  process.exit(0)
}

mkdirSync(dirname(specPath), { recursive: true })
writeFileSync(specPath, spec)
console.log(`wrote ${specPath}`)

const cli = join(archifyHome, 'bin/archify.mjs')
if (!existsSync(cli)) {
  console.log(
    'archify not found; spec written, HTML left unchanged (set ARCHIFY_HOME to rebuild it)',
  )
  process.exit(0)
}
execFileSync(
  'node',
  [cli, 'deliver', 'architecture', specPath, htmlPath, '--quality', 'showcase'],
  { stdio: 'inherit' },
)
console.log(`wrote ${htmlPath}`)
