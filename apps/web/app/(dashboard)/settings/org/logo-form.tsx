'use client'

import { useActionState, useCallback, useState } from 'react'

import { removeOrgLogo, uploadOrgLogo } from './logo-actions'
import { LOGO_REFUSALS, MAX_LOGO_BYTES } from '../../../../lib/org-logo'
import { OrgMark } from '../../../org-mark'
import { buttonClass } from '../../../_ui/primitives'

// Ticket 77's FileDrop, in the states the design system lists for it: empty,
// holding a file, rejected, and uploading. A plain `<input type="file">` and
// not a drag target with its own drop handling — the native control is the
// accessible one, it is a keyboard target for free, and on a phone it opens
// the camera roll, which is where the logo actually is.
//
// Ticket 113: the logo's row — the mark, a pill that opens the file picker
// (the native input, drawn as the pill), Upload once a file is chosen, and
// Remove.

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
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {src ? <OrgMark name={orgName} src={src} size={24} /> : null}
        <form action={upload} className="flex items-center gap-1.5">
          <input type="hidden" name="orgId" value={orgId} />
          <label className={`${buttonClass()} ${PICKER}`}>
            <span className="max-w-32 truncate">
              {chosen ?? (src ? 'Replace' : 'Choose a file')}
            </span>
            <input
              type="file"
              name="logo"
              accept={ACCEPT}
              onChange={choose}
              aria-label="Logo image"
              className="sr-only"
            />
          </label>
          {chosen && !refusal ? (
            <button
              type="submit"
              disabled={uploading}
              className={buttonClass('primary')}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          ) : null}
        </form>
        {src ? (
          <form action={remove}>
            <input type="hidden" name="orgId" value={orgId} />
            <button
              type="submit"
              disabled={removing}
              className="text-text-muted hover:text-text text-caption underline"
            >
              {removing ? 'Removing…' : 'Remove'}
            </button>
          </form>
        ) : null}
      </div>

      <div aria-live="polite" className="text-right text-caption">
        {result && 'error' in result ? (
          <p className="text-bad-text">{result.error}</p>
        ) : null}
        {result && 'saved' in result ? (
          <p className="text-text-muted">{result.saved}</p>
        ) : null}
      </div>
    </div>
  )
}

/** The pill that is the file input's label, with the input's focus ring. */
const PICKER =
  'cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-accent-fill'
