import type { ReactNode } from 'react'

import { buttonClass, inputClass } from '../../_ui/primitives'
import {
  CHOICE_LIMIT,
  type ArchiveChoices,
} from '../../../lib/transcript-archive'

// Ticket 140: every transcript the viewer may download, as one zip.
//
// A native disclosure over a `get` form: the fields are the query string the
// route reads, so the download is a plain request that needs no JavaScript,
// and a person can bookmark or retry it. A new tab, as the single download
// does, because every refusal of the route is plain text rather than a page.
// Nothing ticked is everything — the same answer as no filter at all.

const HEADING = 'text-text-muted text-label uppercase'

export function DownloadAll({ choices }: { choices: ArchiveChoices }) {
  const { people, projects, devices } = choices
  return (
    <details className="group">
      <summary className="w-fit cursor-pointer list-none text-body">
        <span className="text-text underline">Download all as a zip</span>
        <span className="text-text-muted text-caption">
          {' '}
          · a folder per person, then per project
        </span>
      </summary>

      <form
        method="get"
        action="/api/logs/download-all"
        target="_blank"
        className="mt-3 flex flex-col gap-4"
      >
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
          <legend className={`${HEADING} mb-1.5`}>
            Active{' '}
            <span className="text-text-muted text-caption font-normal tracking-normal normal-case">
              · a transcript with any Turn in range comes whole
            </span>
          </legend>
          <label className="text-text-muted flex items-center gap-2 text-caption">
            From
            <input type="date" name="from" className={`${inputClass} w-40`} />
          </label>
          <label className="text-text-muted flex items-center gap-2 text-caption">
            To
            <input type="date" name="to" className={`${inputClass} w-40`} />
          </label>
        </fieldset>

        {/* One person is the viewer; a choice between one is no choice. */}
        {people.length > 1 ? (
          <Choices legend="People" name="member" options={people} />
        ) : null}
        <Choices legend="Projects" name="project" options={projects} mono>
          {/* A group rather than a gap, and the spelling the page uses. */}
          <Choice name="project" id="none">
            Outside a repository
          </Choice>
        </Choices>
        {devices.length > 0 ? (
          <Choices
            legend="Devices"
            name="device"
            options={devices}
            mono
            // Whose machine, once there is more than one person to own one.
            showPerson={people.length > 1}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass('primary')}>
            Download zip
          </button>
          <span className="text-text-muted text-caption">
            Nothing ticked means all of them.
          </span>
        </div>
      </form>
    </details>
  )
}

function Choices({
  legend,
  name,
  options,
  mono,
  showPerson,
  children,
}: {
  legend: string
  name: string
  options: { id: string; name: string; person?: string }[]
  mono?: boolean
  showPerson?: boolean
  /** Choices before the listed ones. */
  children?: ReactNode
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={`${HEADING} mb-1`}>{legend}</legend>
      <div className="grid max-h-48 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2">
        {children}
        {options.map((option) => (
          <Choice
            key={option.id}
            name={name}
            id={option.id}
            detail={showPerson ? option.person : undefined}
          >
            <span className={mono ? 'font-mono text-[13px]' : ''}>
              {option.name}
            </span>
          </Choice>
        ))}
      </div>
      {options.length >= CHOICE_LIMIT ? (
        <p className="text-text-muted mt-1 text-caption">
          The first {CHOICE_LIMIT} are listed.
        </p>
      ) : null}
    </fieldset>
  )
}

function Choice({
  name,
  id,
  detail,
  children,
}: {
  name: string
  id: string
  detail?: string
  children: ReactNode
}) {
  return (
    <label className="flex min-w-0 items-baseline gap-2 py-1 text-body">
      <input
        type="checkbox"
        name={name}
        value={id}
        className="accent-text shrink-0 translate-y-px"
      />
      <span className="truncate">{children}</span>
      {detail ? (
        <span className="text-text-muted truncate text-caption">{detail}</span>
      ) : null}
    </label>
  )
}
