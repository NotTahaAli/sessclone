import { notFound } from 'next/navigation'

import { rename } from './actions'
import { InlineName } from '../inline-name'
import { EmptyState } from '../empty-state'
import { PageHeader } from '../page-header'
import { Row, SectionBreak } from '../../_ui/primitives'
import { asViewer } from '../../../lib/db'
import { listOwnDevices, type Device } from '../../../lib/devices'
import { currentViewer } from '../../../lib/viewer'

// Devices is ticket 57: a Member's own machines, their nicknames, and when
// each last reported.
//
// Own, at every Role. An Owner can *see* the Org's Devices — that is the
// Costs breakdown by Device (ticket 56), where the question is where the money
// went. Here the question is "is my laptop still reporting", and a list mixing
// in machines nobody can rename would answer neither.
//
// Direction A (ticket 112): one row per machine, the name with its pencil on
// the left, when it last reported on the right, the key and its counts under.

const whole = new Intl.NumberFormat('en-US')

export default async function Page() {
  const viewer = await currentViewer()
  if (!viewer) notFound()

  const { devices, more } = await asViewer(viewer.userId, (tx) =>
    listOwnDevices(tx),
  )

  // In the Org's timezone, like every other date on the dashboard: a Turn is
  // counted on the Org's day, so a machine's last-reported time is read
  // against the same clock.
  const when = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: viewer.orgTimezone,
  })

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Devices" />

      {devices.length === 0 ? (
        <EmptyState headline="Nothing has reported yet">
          A machine appears here the first time its Collector sends a Turn.
          Install one from Keys, and this fills itself in.
        </EmptyState>
      ) : (
        <>
          <p className="text-text-muted mt-3 text-caption">
            Every machine that has reported under your account. The name is
            yours to change and is what the Costs breakdown shows; the key
            underneath is how a machine identifies itself and never changes, so
            renaming keeps its history.
          </p>
          <SectionBreak>Last reported</SectionBreak>
          <ol>
            {devices.map((device) => (
              <DeviceRow key={device.id} device={device} when={when} />
            ))}
          </ol>
          {more ? (
            <p className="text-text-muted mt-3 text-caption">
              Only your {devices.length} most recently seen machines are shown.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

function DeviceRow({
  device,
  when,
}: {
  device: Device
  when: Intl.DateTimeFormat
}) {
  return (
    <li>
      {/* Ticket 90's second look: the pencil sits beside the name rather
          than a labelled form under every machine on the page. */}
      <Row
        lead="none"
        meta={when.format(device.lastSeenAt)}
        // The key only under a nickname: with none, the name is already the
        // key, and printing it twice reads as two facts about one machine.
        sub={
          <>
            {device.nickname === null ? null : (
              <span className="font-mono">{device.key} · </span>
            )}
            first seen {when.format(device.firstSeenAt)} ·{' '}
            {whole.format(device.sessions)}{' '}
            {device.sessions === 1 ? 'session' : 'sessions'} in the last 30 days
          </>
        }
      >
        <InlineName
          action={rename}
          hidden={`deviceId=${device.id}`}
          current={device.nickname}
          fallback={device.key}
          label={`Name for ${device.key}`}
          placeholder="Work laptop"
          mono
        />
      </Row>
    </li>
  )
}
