import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import {
  ArchivalNote,
  StoredTranscripts,
} from '../app/(dashboard)/transcripts/stored-transcripts'

// 2026-09-24: `/transcripts` threw React error #418 on every load of a
// production build. The Delete all disclosure (`<details>`, holding a `<form>`
// and a `<p>`) sat inside a `<p>`. The HTML parser closes a `<p>` when a
// `<details>` opens, so the DOM the browser built was not the tree React
// rendered, and hydration failed. No `<p>` on this listing may hold a block.

vi.mock('../app/(dashboard)/transcripts/artifact-actions', () => ({
  deleteProject: () => {},
  deleteSession: () => {},
}))

const MEMBER = '33333333-3333-4333-8333-333333333333'

const PROJECTS = [
  {
    memberId: MEMBER,
    memberEmail: null,
    orgName: null,
    projectId: null,
    projectKey: 'local:vm:/work/e2e',
    sessions: 1,
    bytes: 2048,
    newest: new Date('2026-09-24T12:00:00Z'),
  },
]
const SESSIONS = [
  {
    id: 'a1',
    memberId: MEMBER,
    projectId: null,
    sessionId: 's1',
    agentId: null,
    bytes: 2048,
    uploadedAt: new Date('2026-09-24T12:00:00Z'),
    lastTurnAt: null,
    chunked: false,
  },
]
const NAMES = new Map<string, string>()

test('no paragraph holds a block the parser would close it on', () => {
  const html = renderToStaticMarkup(
    <StoredTranscripts
      projects={PROJECTS}
      sessions={SESSIONS}
      more={false}
      orgNames={NAMES}
      timezone="UTC"
    />,
  )

  expect(html).toContain('<details')
  // Every `<p>`'s content up to its own close, and none of it a block.
  for (const [, inside] of html.matchAll(/<p[\s>]((?:(?!<\/p>).)*)<\/p>/gs))
    expect(inside).not.toMatch(/<(details|form|p|div|ol|ul|section)[\s>]/)
})

// 2026-09-24: the "Yours" intro said archival "is off until you turn it on"
// to a Member whose archival was on. It reads the switch the page already
// loads, one per membership.
/** Markup to its text, stripped until nothing changes (CodeQL js/incomplete-multi-character-sanitization). */
const text = (html: string) => {
  let previous
  do {
    previous = html
    html = html.replace(/<[^>]*>/g, '')
  } while (html !== previous)
  return html
}

/** The sentence, as text, for one switch per Org. */
const note = (...enabled: boolean[]) =>
  text(
    renderToStaticMarkup(
      ArchivalNote({
        memberships: enabled.map((archival_enabled, index) => ({
          member_id: `m${index}`,
          org_id: `o${index}`,
          org_name: `Org ${index}`,
          archival_enabled,
        })),
      }),
    ),
  )

test('the archival sentence says what the switch actually is', () => {
  expect(note(false)).toBe(
    'Archival is a setting, and it is off until you turn it on.',
  )
  expect(note(true)).toBe(
    'Archival is on, and it stays on until you turn it off.',
  )
  expect(note(true, false, true)).toBe(
    'Archival is on in 2 of your 3 Orgs, and off in the rest.',
  )
})
