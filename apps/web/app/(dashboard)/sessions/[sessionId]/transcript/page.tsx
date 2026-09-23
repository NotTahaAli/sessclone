import Link from 'next/link'

import { PageHeader } from '../../../page-header'
import { currentViewer } from '../../../../../lib/viewer'
import {
  deletePreset,
  listPresets,
  savePreset,
  setDefaultPreset,
} from './preset-actions'
import { TranscriptViewer } from './viewer'

// Tickets 102-105: one Session's transcript, read in the browser.
//
// This page carries no transcript bytes and asks the database for nothing
// about the Session: the viewer fetches the file list from
// `/api/transcripts/<id>`, whose answer `log_artifacts_read` decides — the
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
  const sessionId = decodeURIComponent(raw)
  const presets = await listPresets().catch(() => null)

  return (
    <div className="flex flex-col gap-4">
      {/* The member is only for the way back: the Session's own page needs
          it to reach an index, this one does not. */}
      {member && UUID.test(member) ? (
        <Link
          href={`/sessions/${encodeURIComponent(sessionId)}?member=${member}`}
          className="text-text-secondary hover:text-text w-fit text-caption"
        >
          ‹ Session
        </Link>
      ) : null}
      <PageHeader title="Transcript" />
      <TranscriptViewer
        sessionId={sessionId}
        timezone={viewer.orgTimezone}
        presets={presets?.ok ? presets.value : null}
        actions={ACTIONS}
        settingsHref="/settings/you#archival"
      />
    </div>
  )
}
