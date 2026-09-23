import {
  APPEARANCE_COOKIE,
  APPEARANCE_COOKIE_MAX_AGE,
  APPEARANCE_PATTERN,
} from '../lib/appearance'
import { ACCENT_PROPERTIES } from './apply-appearance'

// Ticket 77, last criterion: "Theme applies on first paint with no flash,
// including for a signed-out visitor on the marketing site."
//
// The signed-out half needs nothing — `globals.css` follows
// `prefers-color-scheme` and no attribute is written, which is why the design
// system says "nothing has to run before first paint" for that case. The
// signed-in half is the hard one, and this is the whole of it: a script in
// `<head>` that the browser runs synchronously while parsing, before anything
// is painted.
//
// It cannot be a server render of `<html data-theme>`. The attribute lives on
// the root layout, which every route shares, and reading the session or the
// cookie there would opt the entire product out of static prerendering and,
// under Cache Components, block every segment beneath it — undoing tickets 80
// and 83 for a colour. Next's own guide
// (`node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`)
// reaches the same conclusion and recommends exactly this.
//
// Three properties of the script matter more than its size:
//
//  - **It is inert without a cookie.** A visitor who has never signed in runs
//    seven bytes of regular expression and leaves the document alone.
//  - **It validates before it writes.** The pattern is shared with
//    `lib/appearance.ts` so the two ends cannot drift.
//  - **It sets custom properties rather than colours.** Every painted value is
//    already a `var()` in the stylesheet; this fills in the same seven
//    properties the design system's own example writes inline.

// One statement per property rather than a loop over a names array, because
// the names are then the only data the script carries.
const APPLY = `var p=v.split(":"),c=p[1].split(","),r=document.documentElement;
if(p[0]==="system")r.removeAttribute("data-theme");else r.setAttribute("data-theme",p[0]);
${ACCENT_PROPERTIES.map(
  (property, index) => `r.style.setProperty("${property}","#"+c[${index}]);`,
).join('')}`

const source = (read: string, then = '') =>
  `(function(){try{var v=${read};if(!/${APPEARANCE_PATTERN}/.test(v))return;${APPLY}${then}}catch(e){}})()`
    .split('\n')
    .join('')

// No cookie leaves `v` empty, which fails the pattern and returns: a visitor
// who has never signed in runs one regular expression and leaves the document
// alone.
const SCRIPT = source(
  'decodeURIComponent((document.cookie.match(' +
    `/(?:^|; )${APPEARANCE_COOKIE}=([^;]*)/` +
    ')||[,""])[1])',
)

/**
 * The same statements, applied to a value the server chose rather than to the
 * cookie — and writing that value back into the cookie, so the next load needs
 * none of this. `appearance-sync.tsx` says when that happens and why.
 *
 * A `<script>` rather than a client component with an effect: it runs while the
 * document is parsed, so the correction lands before the first paint instead of
 * after hydration, and it still works on a page whose JavaScript has not
 * arrived. The layout renders only on a full load, which is exactly when a
 * script tag in the markup executes.
 */
export const applyAppearanceSource = (value: string) =>
  source(
    JSON.stringify(value),
    `document.cookie="${APPEARANCE_COOKIE}="+encodeURIComponent(v)+` +
      `";path=/;max-age=${APPEARANCE_COOKIE_MAX_AGE};samesite=lax"+` +
      `(location.protocol==="https:"?";secure":"");`,
  )

/** Built once at module load, so the element carries no new object per
 * render — `costs/ranked-list.tsx` does the same for its widths. */
const HTML = { __html: SCRIPT }

export function AppearanceScript() {
  return (
    <script
      // The document is being parsed; there is no React on the page yet, and
      // this is the documented way to run something at that moment.
      // oxlint-disable-next-line no-danger
      dangerouslySetInnerHTML={HTML}
    />
  )
}
