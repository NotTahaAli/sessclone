# 16: Design system foundation

**What to build:** The visual language every later surface is built from, so screens do not diverge as they are added.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Colour, type scale, spacing, and radii defined as tokens
- [x] Light and dark both defined, neither an afterthought
- [x] Component inventory covering what the dashboard and marketing site need
- [x] Chart colours chosen to stay legible in both themes and to colour-blind viewers

**Answer:** `docs/design/design-system.md` is the system, and it is measured
rather than asserted: every contrast ratio in it was computed, and the chart
palette was searched rather than picked.

Colour, type, space, radius and focus are tokens, and both themes are first
class — the dark values are not a filter over the light ones, they are their own
set, and each ratio is quoted against the worse of the two backgrounds a token
can land on. The fixed half is the ground, the surfaces, the rules, the text
steps and every status colour, identical in every Org. The derived half is five
painted accent tokens resolved from one seed through Material Color Utilities,
computed once on save and written onto `<html>`, so the colour library never
reaches the browser. Three of those five differ between light and dark, which is
why the inline set is seven properties rather than five: an inline style cannot
vary by theme, so the pairs are selected in the stylesheet. Theming is three
states — bare `:root`, `prefers-color-scheme` guarded so a forced mode wins, and
`[data-theme]` — with a `@custom-variant dark` declaration so Tailwind's own
`dark:` utilities agree with the tokens instead of following the system
preference alone.

The inventory is 37 components in six groups, each with its parts, its states
and the ticket that first needs it. Every component that renders fetched data
implements loading, empty and error; every component that renders a Cost also
implements unpriced. What is deliberately absent is listed with the reason,
because the next person's question is always why there is no tab, no tooltip and
no component library.

Chart colours are five series plus a neutral rollup, per theme. Hues are
Okabe-Ito's; lightness and chroma were searched under hard constraints — at
least 3:1 against both the page and the panel a chart is drawn on, chroma at or
above 25, lightness inside a usable band — maximising the smallest CIEDE2000
distance across normal vision and protanopia, deuteranopia and tritanopia
simultaneously, simulated with Brettel, Viénot and Mollon 1997. Worst-case
separation including the neutral is 16.06 in light and 16.41 in dark. There is
no published floor for categorical colour distance and the spec says so rather
than citing one; the strongest published reference point is ΔE00 of 10.
`scripts/colour/` holds the scripts, so a palette change is a re-run rather than
an edit.

Two things are recorded as thin rather than hidden. An accent fill sits at 3.00
against Ivory in two of the six presets and a fully saturated seed reaches 2.99,
so the 1px accent border is mandatory rather than conditional. Light series 1
and the light neutral sit at exactly 3.01, which also sets the floor for the
hatch that marks a part-filled bucket — the stripe is the ground colour at full
opacity, which is provably at least 3:1 on any series that already clears 3:1
against the ground.

The settings that feed the derived half — the Org default seed, the lock, a
Member's own seed and mode, and the Org logo — belong to no ticket that existed
when this one was written. Ticket 77 now owns them. Ticket 20 decides how the
system is implemented, including the Tailwind and PostCSS versions this file
names.
