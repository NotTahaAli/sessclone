import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '../../../page-header'
import { currentViewer } from '../../../../../lib/viewer'
import {
  deletePreset,
  listPresets,
  savePreset,
  setDefaultPreset,
} from './preset-actions'
import { TranscriptViewer } from './viewer'

// Tickets 105-108: one Session's transcript, read in the browser.
//
// This page carries no transcript bytes and asks the database for nothing
// about the Session: the viewer fetches the file list from
// `/api/transcripts/<id>?member=<member>`, whose answer `log_artifacts_read` decides — the
// same rule as Download — and reads the files from storage directly. What is
// read here is the reader's own presets, so the default one applies on the
// first paint rather than after a round trip.

const UUID = /^[0-9a-f-]{1,64}$/i

/** Server Actions travel to the client as references, so one object serves. */
const ACTIONS = {
  save: savePreset,
  remove: deletePreset,
  setDefault: setDefaultPreset,
}

export default async function TranscriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ member?: string }>
}) {
  const viewer = await currentViewer()
  if (!viewer) return null

  const [{ sessionId: raw }, { member }] = await Promise.all([
    params,
    searchParams,
  ])
  // Session ids are unique per Member only, so the Member names the Session
  // as much as its id does; without it this page cannot say whose it is.
  if (!member || !UUID.test(member)) notFound()
  const sessionId = decodeURIComponent(raw)
  const presets = await listPresets().catch(() => null)

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/sessions/${encodeURIComponent(sessionId)}?member=${member}`}
        className="text-text-secondary hover:text-text w-fit text-caption"
      >
        ‹ Session
      </Link>
      <PageHeader title="Transcript" />
      <TranscriptViewer
        sessionId={sessionId}
        memberId={member}
        timezone={viewer.orgTimezone}
        presets={presets?.ok ? presets.value : null}
        actions={ACTIONS}
        settingsHref="/settings/you#archival"
      />
    </div>
  )
}
