'use client'

import { useActionState, useCallback, useState } from 'react'

import { PRESETS } from '../../../lib/accent-presets'

// Ticket 77's SeedPicker, from the design system's component inventory: "Six
// preset swatches, custom swatch, hex field, live preview. Preset selected,
// custom seed, invalid hex, locked by the Org. Each swatch is a real button
// with an aria-label."
//
// One component for both surfaces — a Member's own seed and the Org's default
// — because they are the same control over different rows, and the two
// differences are props: whether an empty value means "inherit the Org's", and
// whether the Org has locked it.
//
// **The preview is of what is stored, not of what is typed.** Resolving a seed
// to its tones needs `@material/material-color-utilities`, and the ticket's
// third criterion is that the library never reaches the browser — so the
// swatches below are the seeds themselves, and the seven resolved values appear
// after a save, painted by the page that read them back. A typed hex therefore
// shows its own colour and not the accent it will become, which is honest: the
// palette puts a floor under chroma, so the two are not always the same colour
// and a preview drawn from the typed value would be a promise the product
// cannot keep.

/** The six presets with their swatch styles, built once at module load. */
const SWATCHES = PRESETS.map((preset) => ({
  ...preset,
  style: { backgroundColor: preset.seed },
}))

export type SeedResult = { error: string } | { saved: string } | null

export function SeedPicker({
  action,
  field,
  rowId,
  current,
  orgSeed,
  locked,
  inheritable,
  label,
}: {
  action: (previous: unknown, formData: FormData) => Promise<SeedResult>
  /** The field naming the row this writes: `memberId`, or `orgId`. Two scalars
   * rather than one object, so no caller builds a prop object per render. */
  field: string
  rowId: string
  /** The stored seed, or null when this row inherits. */
  current: string | null
  /** The Org's default, shown as what inheriting means. */
  orgSeed: string
  /** Set when the Org has locked its accent: everything is read-only. */
  locked?: boolean
  /** Whether clearing the field is a valid answer ("follow the Org's"). */
  inheritable?: boolean
  label: string
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const [typed, setTyped] = useState(current ?? '')

  // The native picker and the hex field write the same value, so they share a
  // field and differ only in case: a colour input always yields lower case,
  // and the stored form is upper.
  const pick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setTyped(event.target.value.toUpperCase()),
    [],
  )
  const type = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setTyped(event.target.value),
    [],
  )

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name={field} value={rowId} />

      <fieldset disabled={locked}>
        <legend className="text-text-secondary text-sm">{label}</legend>

        {/* Each preset is a real submit button carrying its own value, so the
            common case — picking one of the six measured colours — is one
            click and needs no typing, and works with the keyboard and with a
            screen reader naming the colour. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {SWATCHES.map((preset) => {
            const selected =
              (current ?? '').toUpperCase() === preset.seed.toUpperCase()
            return (
              <button
                key={preset.seed}
                type="submit"
                name="seed"
                value={preset.seed}
                aria-label={`${preset.name}, ${preset.seed}`}
                aria-pressed={selected}
                title={preset.name}
                className={`h-[var(--control-h)] w-[var(--control-h)] rounded border ${
                  selected
                    ? 'border-text ring-accent-border ring-2'
                    : 'border-control-border'
                }`}
                style={preset.style}
              />
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label
              className="text-text-secondary text-sm"
              htmlFor={`seed-${field}`}
            >
              Or a hex colour
            </label>
            <div className="flex items-center gap-2">
              {/* The native colour input, which is the platform's own picker
                  and costs nothing: it writes into the same field the hex is
                  typed in, so there is one value and one submit. */}
              <input
                type="color"
                aria-label="Pick a colour"
                value={/^#[0-9a-f]{6}$/i.test(typed) ? typed : orgSeed}
                onChange={pick}
                className="border-control-border h-[var(--control-h)] w-12 rounded border bg-transparent p-1"
              />
              <input
                id={`seed-${field}`}
                // `typed` rather than a second field named `seed`: a submit
                // button carries its own name and value, and two entries under
                // one name would be read in DOM order — so the swatches would
                // work and the "follow the Org's" button below the field would
                // silently submit whatever was typed instead of clearing.
                name="typed"
                value={typed}
                onChange={type}
                placeholder={inheritable ? orgSeed : '#D97757'}
                spellCheck={false}
                autoComplete="off"
                maxLength={9}
                className="border-control-border text-text h-[var(--control-h)] w-28 rounded border px-3 font-mono text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="border-control-border text-text h-[var(--control-h)] rounded border px-3 text-sm"
          >
            {pending ? 'Saving…' : 'Save colour'}
          </button>

          {inheritable && current ? (
            // A named way back, rather than expecting somebody to work out
            // that an empty field means "inherit".
            <button
              type="submit"
              name="seed"
              value=""
              disabled={pending}
              className="text-accent-text h-[var(--control-h)] text-sm underline"
            >
              Follow the Org’s colour
            </button>
          ) : null}
        </div>
      </fieldset>

      <div aria-live="polite">
        {state && 'error' in state ? (
          <p className="text-bad-text mt-3 text-sm">{state.error}</p>
        ) : null}
        {state && 'saved' in state ? (
          <p className="text-ok-text mt-3 text-sm">{state.saved}</p>
        ) : null}
      </div>
    </form>
  )
}
