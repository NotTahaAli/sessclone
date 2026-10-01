# 159: Public pages clear an axe and keyboard pass at WCAG 2.2 AA

**What to build:** An audit of the live public pages (`/`, `/pricing`,
`/demo`, `/docs`, `/sign-in`, `/sign-up`) at 1440x900 and 390x844, light and
dark, with axe-core and a keyboard-only walk, turned up three AA failures:

- `/pricing`: plans that do not fit the chosen team size were faded with
  `opacity-45`, dropping their text to 1.9:1 and 2.95:1 (needs 4.5:1).
- `/` and `/pricing` on a phone: the install command and the plan comparison
  table scroll sideways but could not take focus, so a keyboard could not
  scroll them.
- `/docs` on a phone: Fumadocs removes the focus ring from the
  table-of-contents trigger.

**Blocked by:** none

**Status:** done

- [x] Unfit plans use the muted text token instead of opacity (AA in both
      themes), still visibly quieter than the fitting plan
- [x] Both scroll areas are labelled, focusable regions
- [x] The docs table-of-contents trigger shows the app's focus ring
- [x] axe reports no WCAG A/AA violation on `/`, `/pricing`, `/docs`,
      `/sign-in`, `/sign-up`; every Tab stop on them shows a focus ring

Left as is, on purpose: the `/demo` spend chart's day bars are 11px wide on a
phone (2.5.8 Target Size), but the same days are full-width links in the
"Over time" list on the same page, which is 2.5.8's equivalent-control
exception. Fumadocs' own landmark notes on `/docs` (TOC outside a landmark, a
second `header`) are axe best-practice, not WCAG failures.
