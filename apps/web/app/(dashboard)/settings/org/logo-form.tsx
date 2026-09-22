'use client'

import { useActionState, useCallback, useState } from 'react'

import { removeOrgLogo, uploadOrgLogo } from './logo-actions'
import {
  LOGO_REFUSALS,
  MAX_LOGO_BYTES,
  MIN_LOGO_PIXELS,
} from '../../../../lib/org-logo'
import { OrgMark } from '../../../org-mark'

// Ticket 77's FileDrop, in the states the design system lists for it: empty,
// holding a file, rejected, and uploading. A plain `<input type="file">` and
// not a drag target with its own drop handling — the native control is the
// accessible one, it is a keyboard target for free, and on a phone it opens
// the camera roll, which is where the logo actually is.

const ACCEPT = 'image/png,image/jpeg,image/webp'

export function LogoForm({
  orgId,
  orgName,
  src,
}: {
  orgId: string
  orgName: string
  /** The current logo, if there is one. */
  src: string | null
}) {
  const [state, upload, uploading] = useActionState(uploadOrgLogo, null)
  const [removeState, remove, removing] = useActionState(removeOrgLogo, null)
  const [chosen, setChosen] = useState<string | null>(null)

  const [refusal, setRefusal] = useState<string | null>(null)

  const choose = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Checked here as well as in the action, because Next refuses a Server
    // Action body over 1 MB before the action runs at all — so the common
    // failure, a phone photo, would otherwise produce a framework error page
    // instead of the sentence that says what is wrong.
    setRefusal(
      file && file.size > MAX_LOGO_BYTES ? LOGO_REFUSALS.too_large : null,
    )
    setChosen(file?.name ?? null)
  }, [])

  const result = refusal ? { error: refusal } : (state ?? removeState)

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <OrgMark name={orgName} src={src} size={32} />
        <p className="text-text-secondary text-sm">
          {src
            ? 'Shown in the navigation, on sign-in from an invitation, and in invitation emails.'
            : `No logo, so the Org’s initial is shown instead. PNG, JPEG or WebP, at least ${MIN_LOGO_PIXELS}px on each side and under ${Math.round(MAX_LOGO_BYTES / 1024)} kB.`}
        </p>
      </div>

      <form action={upload} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="orgId" value={orgId} />
        <input
          type="file"
          name="logo"
          accept={ACCEPT}
          onChange={choose}
          aria-label="Logo image"
          className="text-text-secondary file:border-control-border file:bg-surface hover:file:bg-surface-hover text-sm file:mr-3 file:h-[var(--control-h)] file:border file:px-4 file:font-mono file:text-xs file:uppercase"
        />
        <button
          type="submit"
          disabled={uploading || !chosen || Boolean(refusal)}
          className="border-control-border text-label hover:bg-surface-hover h-[var(--control-h)] border px-4 font-mono uppercase disabled:opacity-50"
        >
          {uploading ? 'Uploading' : src ? 'Replace' : 'Upload'}
        </button>
      </form>

      {src ? (
        <form action={remove} className="mt-3">
          <input type="hidden" name="orgId" value={orgId} />
          <button
            type="submit"
            disabled={removing}
            className="border-control-border text-label hover:bg-surface-hover h-[var(--control-h)] border px-4 font-mono uppercase disabled:opacity-50"
          >
            {removing ? 'Removing' : 'Remove logo'}
          </button>
        </form>
      ) : null}

      <div aria-live="polite">
        {result && 'error' in result ? (
          <p className="text-bad-text mt-3 text-sm">{result.error}</p>
        ) : null}
        {result && 'saved' in result ? (
          <p className="text-ok-text mt-3 text-sm">{result.saved}</p>
        ) : null}
      </div>
    </div>
  )
}
