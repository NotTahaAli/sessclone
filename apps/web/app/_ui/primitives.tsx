import Link from 'next/link'
import type {
  ButtonHTMLAttributes,
  ChangeEventHandler,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
} from 'react'

// Direction A's shared primitives (ticket 111), drawn from the approved
// "Log" design and the transcript viewer it grew out of. Every page ticket 112
// rebuilds is made of these. No box around a section, no shadow, and the
// accent only where the transcript page uses it: a live state, the current
// bar, the logo stroke. Server-safe: nothing here needs the browser, so a
// Server Component renders them and a client one can import them too.
// `pill-menu.tsx` holds the one piece that does need the browser.

/** The dropdown chevron. An SVG, never the ⌄ glyph, which sits off-centre in
 * most faces (Taha, 2026-09-23). 12px, stroke 1.6, centred in its box. */
export function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-text-muted shrink-0 ${className ?? ''}`}
    >
      <path d="M3 4.5 6 7.5 9 4.5" />
    </svg>
  )
}

/** A row's leading mark when it opens something. */
const Chevron = () => (
  <span aria-hidden="true" className="text-text-muted text-[13px]">
    ›
  </span>
)

/** Session and step state, as the transcript draws it: ✱ live in the accent,
 * ✓ done in the ok colour, ○ idle. The glyph is decorative; the row's text
 * says the state in words. */
export function StatusGlyph({ state }: { state: 'live' | 'ok' | 'idle' }) {
  const [glyph, tone] = {
    live: ['✱', 'text-accent-text'],
    ok: ['✓', 'text-ok-text'],
    idle: ['○', 'text-text-muted'],
  }[state]
  return (
    <span aria-hidden="true" className={tone}>
      {glyph}
    </span>
  )
}

/**
 * A 3px bar under a row's name. `current` paints it in the accent — the one
 * bar on a surface that is "now"; every other bar is the neutral meter ink.
 * Hidden from assistive tech: the row's value already says the number.
 */
export function Meter({
  value,
  current,
  className,
}: {
  /** 0 to 1; clamped. */
  value: number
  current?: boolean
  className?: string
}) {
  // An SVG so the width is an attribute string, not a style object.
  const width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
  return (
    <svg
      aria-hidden="true"
      className={`bg-surface-hover block h-[3px] w-full overflow-hidden rounded-[2px] ${className ?? ''}`}
    >
      <rect
        width={width}
        height="100%"
        className={current ? 'fill-accent-fill' : 'fill-meter'}
      />
    </svg>
  )
}

const ROW =
  '-mx-2.5 grid grid-cols-[14px_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-md px-2.5 py-[9px] text-body leading-[1.45]'

/**
 * The list row: a leading mark, a name that truncates, a right-aligned mono
 * value, then an optional meter and sub line under the name.
 *
 * The lead defaults to the › chevron. `lead` swaps it for a status glyph, or
 * `none` for an empty column that keeps names aligned; `mark` puts a short
 * text in its place (an initial, a tone mark). With `href` the row is a link
 * and takes the hover fill; `selected` is the row a side column is showing,
 * and is the only filled row on a surface.
 *
 * The name is `name` when it is a string and `children` when it is more
 * (a pencil, a muted or mono span). Everything a caller passes is data or
 * children, never an element in a prop: `react-perf/jsx-no-jsx-as-prop`.
 * A control beside a row (Revoke, Withdraw) sits outside it, in the list item.
 */
export function Row({
  name,
  children,
  value,
  meta,
  sub,
  meter,
  meterCurrent,
  lead,
  mark,
  markClass = 'text-text-muted',
  href,
  selected,
}: {
  name?: string
  children?: ReactNode
  /** A figure: mono 13px in the text colour. */
  value?: string
  /** Metadata in the value's place: mono 12px, muted. Ignored when `value` is
   * given. */
  meta?: string
  sub?: ReactNode
  /** 0 to 1, drawn as a `Meter` under the name. */
  meter?: number
  meterCurrent?: boolean
  lead?: 'live' | 'ok' | 'idle' | 'none'
  mark?: string
  markClass?: string
  href?: string
  selected?: boolean
}) {
  const body = (
    <>
      <span className="self-center leading-none">
        {mark !== undefined ? (
          <span aria-hidden="true" className={markClass}>
            {mark}
          </span>
        ) : lead === undefined ? (
          <Chevron />
        ) : lead === 'none' ? null : (
          <StatusGlyph state={lead} />
        )}
      </span>
      <span className="truncate">{name ?? children}</span>
      {value !== undefined ? (
        <span className="font-mono text-[13px] tabular-nums">{value}</span>
      ) : meta !== undefined ? (
        <span className="text-text-muted font-mono text-caption tabular-nums">
          {meta}
        </span>
      ) : (
        <span />
      )}
      {meter === undefined ? null : (
        <Meter
          value={meter}
          current={meterCurrent}
          className="col-start-2 col-end-4 mt-1.5"
        />
      )}
      {sub ? (
        <span className="text-text-muted col-start-2 col-end-4 mt-0.5 truncate text-caption">
          {sub}
        </span>
      ) : null}
    </>
  )
  const tone = selected ? 'bg-selected' : ''
  return href ? (
    <Link
      href={href}
      aria-current={selected ? 'page' : undefined}
      className={`${ROW} ${tone} ${selected ? '' : 'hover:bg-surface-hover'}`}
    >
      {body}
    </Link>
  ) : (
    <div className={`${ROW} ${tone}`}>{body}</div>
  )
}

/**
 * The section break: a hairline either side of a small centred label. It is
 * the only divider Direction A uses between groups of rows, so it is a
 * heading by default — the label is what the rows below it are.
 */
export function SectionBreak({
  children,
  as: Tag = 'h2',
}: {
  children: ReactNode
  as?: 'h2' | 'h3' | 'div'
}) {
  return (
    <Tag className="text-text-muted mt-4 mb-1.5 flex items-center gap-2.5 text-caption font-normal before:h-px before:flex-1 before:bg-rule after:h-px after:flex-1 after:bg-rule">
      {children}
    </Tag>
  )
}

/** The pill's look, for a `<Link>` or a `<summary>` that has to be one. */
export const pillClass =
  'border-rule text-text hover:bg-surface-hover inline-flex h-[var(--pill-h)] min-w-0 items-center gap-1.5 rounded-full border px-3 text-[13px] leading-none whitespace-nowrap'

/** A header pill: a label, an optional muted detail, and the dropdown
 * chevron. `PillMenu` wraps one around a menu; alone it is a button. */
export function Pill({
  children,
  detail,
  chevron = true,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  detail?: ReactNode
  chevron?: boolean
}) {
  return (
    <button
      type="button"
      className={`${pillClass} ${className ?? ''}`}
      {...props}
    >
      <span className="truncate">{children}</span>
      {detail ? (
        <span className="text-text-muted truncate text-caption">
          · {detail}
        </span>
      ) : null}
      {chevron ? <ChevronDown /> : null}
    </button>
  )
}

const BUTTON = {
  primary: 'bg-text text-ground border-text hover:opacity-90',
  secondary: 'border-rule text-text hover:bg-surface-hover',
  danger: 'border-bad-border text-bad-text hover:bg-bad-bg',
} as const

/** A button's look, for a `<Link>` that acts as one. */
export const buttonClass = (variant: keyof typeof BUTTON = 'secondary') =>
  `inline-flex h-[var(--pill-h)] items-center justify-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap disabled:opacity-50 ${BUTTON[variant]}`

/** The round button. `primary` is filled with the text colour, not the
 * accent: one per surface, and the accent stays for state. */
export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON
}) {
  return (
    <button
      type={type}
      className={`${buttonClass(variant)} ${className ?? ''}`}
      {...props}
    />
  )
}

/** A text field's look: the round field beside a primary button. */
export const inputClass =
  'border-rule bg-field text-text placeholder:text-text-muted h-[var(--pill-h)] min-w-0 rounded-full border px-3 text-[13px]'

/** The one boxed surface Direction A keeps, for a summary that has to read
 * as a unit (the landing status, a pricing pick). Rare on purpose. */
export const cardClass = 'bg-surface border-rule rounded-lg border px-3.5 py-3'

/**
 * On/off. A real checkbox with `role="switch"`, so it posts with a form and
 * the keyboard toggles it; the track is drawn by a sibling the input sits
 * over. Pass `checked`/`onChange` or `defaultChecked`, as on any input.
 */
export function Switch({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'>) {
  return (
    <span
      className={`relative inline-flex h-5 w-[34px] shrink-0 ${className ?? ''}`}
    >
      <input
        type="checkbox"
        role="switch"
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden="true"
        className="bg-rule-strong peer-checked:bg-text peer-focus-visible:outline-accent-fill peer-disabled:opacity-50 absolute inset-0 rounded-full transition-colors peer-focus-visible:outline-3 peer-focus-visible:outline-offset-1 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-ground after:shadow-[0_1px_2px_rgb(0_0_0/0.2)] after:transition-transform peer-checked:after:translate-x-3.5"
      />
    </span>
  )
}

/**
 * The segmented pill: a radio group drawn as one pill, the chosen segment
 * filled with the text colour. Native radios, so it posts with a form and
 * arrow keys move between segments. Controlled with `value` + `onChange`,
 * or uncontrolled with `defaultValue`.
 */
export function Segmented<T extends string>({
  name,
  options,
  value,
  defaultValue,
  onChange,
  label,
}: {
  name: string
  options: readonly { value: T; label: ReactNode }[]
  value?: T
  defaultValue?: T
  onChange?: (value: T) => void
  /** The group's accessible name. */
  label: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="border-rule inline-flex rounded-full border p-0.5 text-caption"
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="text-text-muted has-[:checked]:bg-text has-[:checked]:text-ground has-[:focus-visible]:outline-accent-fill relative flex cursor-pointer items-center rounded-full px-2.5 py-1 has-[:focus-visible]:outline-3"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            className="sr-only"
            {...(value === undefined
              ? { defaultChecked: option.value === defaultValue }
              : {
                  checked: option.value === value,
                  onChange: () => onChange?.(option.value),
                })}
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}

const SWATCH =
  'relative inline-block size-5 shrink-0 cursor-pointer rounded-full disabled:cursor-not-allowed disabled:opacity-50'
const SWATCH_ON = 'ring-text ring-offset-ground ring-[1.5px] ring-offset-2'

/** A row of swatches: a group with a name, 6px apart. */
export function SwatchRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {children}
    </div>
  )
}

/** One colour. A real button, named by `label`, pressed when selected. Pass
 * `type="submit"` with a `name`/`value` to post it, as the seed picker does. */
export function Swatch({
  color,
  label,
  selected,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  color: string
  label: string
  selected?: boolean
}) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className={`${SWATCH} ${selected ? SWATCH_ON : ''} ${className ?? ''}`}
      {...props}
    >
      <Disc color={color} />
    </button>
  )
}

/** A swatch's colour, as an SVG fill so it is an attribute, not a style. */
const Disc = ({ color }: { color: string }) => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="block size-full">
    <circle cx="10" cy="10" r="10" fill={color} />
  </svg>
)

/** The rainbow the custom swatch wears until a hex is picked. */
const RAINBOW: CSSProperties = {
  background:
    'conic-gradient(from 0deg, #c2562f, #b08a1e, #2f7d5b, #3d6fb6, #7a52b3, #c2562f)',
}

/**
 * The last swatch, which takes any colour: the platform's own colour input,
 * invisible over a rainbow disc. Selected, it shows the chosen colour
 * instead. `value` is `#rrggbb`, as a colour input requires.
 */
export function CustomSwatch({
  value,
  onChange,
  selected,
  label = 'Any colour',
  name,
  disabled,
}: {
  value: string
  onChange?: ChangeEventHandler<HTMLInputElement>
  selected?: boolean
  label?: string
  name?: string
  disabled?: boolean
}) {
  return (
    <label
      title={label}
      className={`${SWATCH} has-[:focus-visible]:outline-accent-fill has-[:focus-visible]:outline-3 ${selected ? SWATCH_ON : ''}`}
      style={RAINBOW}
    >
      {selected ? <Disc color={value} /> : null}
      <input
        type="color"
        aria-label={label}
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  )
}

/**
 * A settings line: the label on the left, its control or value on the right,
 * an optional hint under both. No hairline between lines: the section breaks
 * are the only dividers, and a rule under every line doubled up against them
 * (Taha, 2026-09-23). `htmlFor` makes
 * the label a real `<label>` for a control with an id.
 */
export function Field({
  label,
  hint,
  htmlFor,
  indent,
  mono,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  htmlFor?: string
  /** A nested line, such as one Project under an Org-wide switch. */
  indent?: boolean
  /** A label that is a key rather than prose: mono, truncated, whole on hover. */
  mono?: boolean
  children: ReactNode
}) {
  const Label = htmlFor ? 'label' : 'span'
  return (
    <div className="grid grid-cols-[minmax(min(40%,10rem),1fr)_minmax(0,auto)] items-center gap-x-3 gap-y-1 py-[11px]">
      <Label
        htmlFor={htmlFor}
        title={mono && typeof label === 'string' ? label : undefined}
        className={`${mono ? 'block truncate font-mono text-[13px]' : 'text-body'} ${indent ? 'pl-3.5' : ''}`}
      >
        {label}
      </Label>
      {/* A plain value reads as data, mono and muted; a control keeps its
          own type. */}
      <span
        className={`min-w-0 justify-self-end text-right ${typeof children === 'string' ? 'text-text-muted font-mono text-[13px]' : ''}`}
      >
        {children}
      </span>
      {hint ? (
        <span className="text-text-muted col-span-2 text-caption">{hint}</span>
      ) : null}
    </div>
  )
}
