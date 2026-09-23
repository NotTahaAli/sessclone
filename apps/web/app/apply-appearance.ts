// What the browser does with an encoded appearance (`lib/appearance.ts`'s
// `encodeAppearance`) once it has one. Imports nothing, so a client component
// can take it without pulling `lib/appearance` — and the colour library behind
// it — into the bundle (`test/client-bundle.test.ts`).
//
// Two callers, one per way a page arrives:
//
//  - **A full load.** `appearance-script.tsx` inlines the same statements as a
//    `<script>` that runs while the document is parsed, before the first paint.
//  - **A soft refresh** — a Server Action that revalidated, such as saving an
//    accent. The shell re-renders from the RSC payload, and a `<script>` that
//    React inserts is never executed, so `AppearanceLive` calls this instead.

/** The tokens, in the order `encodeAppearance` writes them. */
export const ACCENT_PROPERTIES = [
  '--accent-fill',
  '--accent-on-fill',
  '--accent-border',
  '--accent-text-light',
  '--accent-text-dark',
  '--accent-subtle-light',
  '--accent-subtle-dark',
] as const

/** The slice of `document.documentElement` this writes, so a test can pass a
 * stand-in. */
export type AppearanceRoot = {
  style: { setProperty(name: string, value: string): void }
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** Applies `theme:hex,…` to the root. The value is the server's own encoding,
 * not a cookie, so it is not re-validated here. */
export const applyAppearance = (value: string, root: AppearanceRoot) => {
  const [theme = '', joined = ''] = value.split(':')
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  const hexes = joined.split(',')
  ACCENT_PROPERTIES.forEach((property, index) =>
    root.style.setProperty(property, `#${hexes[index]}`),
  )
}
