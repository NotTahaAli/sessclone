'use client'

import { useActionState, useCallback, useState } from 'react'

import {
  Button,
  CustomSwatch,
  Swatch,
  SwatchRow,
  inputClass,
} from '../../_ui/primitives'
import { canonicalHex, PRESETS } from '../../../lib/accent-presets'

// Ticket 77's SeedPicker, redrawn for ticket 113: six preset swatches and a
// seventh that takes any colour, in one row, with the hex beside them to edit
// in place. Each swatch is a real button with an aria-label.
//
// One component for both surfaces — a Member's own seed and the Org's default
// — because they are the same control over different rows, and the two
// differences are props: whether an empty value means "inherit the Org's", and
// whether the Org has locked it.
//
// **Picking a preset saves it; any other colour is typed or picked, then
// saved.** The seventh swatch is the platform's own colour input
// (`CustomSwatch`), and it and the hex field write one value. The field is
// checked here as it is typed, with the same shape rule the server applies
// (`canonicalHex`), so a malformed hex is refused before it is posted; the
// server's `readSeed` still decides, and refuses a grey the palette cannot
// hold, and that refusal is shown under the row.
//
// **The preview is of what is stored, not of what is picked.** Resolving a
// seed to its tones needs `@material/material-color-utilities`, which never
// reaches the browser — so the swatch shows the colour picked, and the
// resolved tones appear after a save, painted by the page that read them back.

export type SeedResult = { error: string } | { saved: string } | null

const isPreset = (hex: string | null) =>
  hex !== null && PRESETS.some((preset) => preset.seed === hex)

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
  const [shown, setShown] = useState(current)

  // A save re-renders the page with the new stored seed; the field follows
  // it, so a preset picked after typing does not leave the typed colour
  // waiting to be saved. Adjusted during render, React's own answer for state
  // derived from a changed prop, rather than an effect.
  if (shown !== current) {
    setShown(current)
    setTyped(current ?? '')
  }

  const stored = current ? canonicalHex(current) : null
  const wanted = canonicalHex(typed)
  // Something new to save: a valid hex that is not what is stored.
  const dirty = wanted !== null && wanted !== stored
  const malformed = typed.trim() !== '' && wanted === null
  // The seventh swatch wears the custom colour in force, or the one being
  // picked; the rainbow when neither is off the preset list.
  const custom = dirty
    ? isPreset(wanted)
      ? null
      : wanted
    : isPreset(stored)
      ? null
      : stored

  // The native picker yields lower case, and the stored form is upper.
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
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name={field} value={rowId} />

      <fieldset
        disabled={locked || pending}
        className="flex flex-col items-end gap-1.5"
      >
        {/* The form's default button, first in the tree: Enter in the hex
            field presses this, which posts the field — not the first
            swatch, which would silently save Clay instead. */}
        <button
          type="submit"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        >
          Save
        </button>

        {/* Each preset is a submit button carrying its own value, so the
            common case — one of the six measured colours — is one click. */}
        <SwatchRow label={label}>
          {PRESETS.map((preset) => (
            <Swatch
              key={preset.seed}
              type="submit"
              name="seed"
              value={preset.seed}
              color={preset.seed}
              label={`${preset.name}, ${preset.seed}`}
              selected={!dirty && stored === preset.seed}
            />
          ))}
          <CustomSwatch
            value={(custom ?? wanted ?? stored ?? orgSeed).toLowerCase()}
            onChange={pick}
            selected={custom !== null}
            label="Any colour"
          />
        </SwatchRow>

        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor={`seed-${field}`}>
            Hex colour
          </label>
          {/* `typed` rather than a second field named `seed`: a submit
              button carries its own name and value, and two entries under one
              name would be read in DOM order — so the "follow the Org's"
              button would silently submit whatever was typed instead of
              clearing. */}
          <input
            id={`seed-${field}`}
            name="typed"
            value={typed}
            onChange={type}
            placeholder={inheritable ? orgSeed : '#D97757'}
            spellCheck={false}
            autoComplete="off"
            maxLength={9}
            aria-invalid={malformed}
            aria-describedby={`seed-${field}-note`}
            className={`${inputClass} h-7 w-24 font-mono text-caption`}
          />
          {dirty ? (
            <Button type="submit" variant="primary" className="h-7">
              {pending ? 'Saving…' : 'Save'}
            </Button>
          ) : null}
          {inheritable && current && !dirty ? (
            // A named way back, rather than expecting somebody to work out
            // that an empty field means "inherit".
            <button
              type="submit"
              name="seed"
              value=""
              className="text-text-muted hover:text-text text-caption underline"
            >
              Use the Org’s
            </button>
          ) : null}
        </div>
      </fieldset>

      <div id={`seed-${field}-note`} aria-live="polite" className="text-right">
        {malformed ? (
          <p className="text-bad-text text-caption">
            A seed is a hex colour, like #D97757.
          </p>
        ) : state && 'error' in state ? (
          <p className="text-bad-text text-caption">{state.error}</p>
        ) : state && 'saved' in state ? (
          <p className="text-text-muted text-caption">{state.saved}</p>
        ) : null}
      </div>
    </form>
  )
}
