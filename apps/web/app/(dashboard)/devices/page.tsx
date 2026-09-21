import { notFound } from 'next/navigation'

import { RenameForm } from './rename-form'
import { EmptyState } from '../empty-state'
import { PageHeader } from '../page-header'
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
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Devices" />

      {devices.length === 0 ? (
        <EmptyState headline="Nothing has reported yet">
          A machine appears here the first time its Collector sends a Turn.
          Install one from Keys, and this fills itself in.
        </EmptyState>
      ) : (
        <>
          <p className="text-text-secondary text-sm">
            Every machine that has reported under your account. The name is
            yours to change and is what the Costs breakdown shows; the key
            underneath is how a machine identifies itself and never changes, so
            renaming keeps its history.
          </p>
          <ul className="flex flex-col gap-4">
            {devices.map((device) => (
              <DeviceCard key={device.id} device={device} when={when} />
            ))}
          </ul>
          {more ? (
            <p className="text-text-muted text-caption">
              Only your {devices.length} most recently seen machines are shown.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

function DeviceCard({
  device,
  when,
}: {
  device: Device
  when: Intl.DateTimeFormat
}) {
  return (
    <li className="border-rule bg-surface rounded-md border p-4">
      <h2 className="text-heading break-words">
        {device.nickname ?? device.key}
      </h2>
      {/* Only under a nickname: with none, the heading is already the key, and
          printing it twice reads as two facts about one machine. */}
      {device.nickname === null ? null : (
        <p className="text-text-muted mt-1 font-mono text-caption break-all">
          {device.key}
        </p>
      )}
      <p className="text-text-secondary mt-2 text-sm">
        Last reported {when.format(device.lastSeenAt)} · first seen{' '}
        {when.format(device.firstSeenAt)} · {whole.format(device.turns)}{' '}
        {device.turns === 1 ? 'turn' : 'turns'} in the last 30 days
      </p>

      <RenameForm
        deviceId={device.id}
        nickname={device.nickname}
        deviceKey={device.key}
      />
    </li>
  )
}
