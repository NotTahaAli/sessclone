# Design system

The visual language every sessclone surface is built from: the dashboard, the
marketing site and the invitation email. It fixes colour, type, space, radius
and focus as tokens, names every component with its parts and its states, and
sets the chart palette. It builds none of it.

Two tickets carry the rest:

- **Ticket 77 — appearance and branding.** The Org's default accent seed and
  its lock flag, a Member's own seed and light/dark preference, the Org logo
  upload and storage, and the RLS policy that lets a Member write only their
  own row. That is the half of this system that is derived rather than fixed;
  without ticket 77 nothing feeds it. Specified in
  `.scratch/sessclone-v1/issues/77-appearance-and-branding.md`.
- **Ticket 20 — architecture.** How components are built and where they live,
  plus the Tailwind dependency itself. This file names the components and
  their states; ticket 20 decides their shape.

One rule runs through the whole thing: the ground is fixed and the accent is
derived, so an Org can recolour the product without recolouring the product's
meaning.

## The shape of the system

| Half       | What is in it                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed      | Ground, surfaces, rules, text and every status colour. Identical in every Org.                                                                       |
| Derived    | Five painted accent tokens, computed from one seed colour through Material Color Utilities, plus the seed itself, which is stored and never painted. |
| Per Member | Mode and seed. An Org sets the default and may lock the seed; mode is always personal.                                                               |

### Accent is interaction. Status is state.

The accent paints buttons, links, focus rings, the active nav item and the
primary chart series. It never paints success, warning, error or info, those
never borrow it, and nothing static — a callout, a diagram, a decorative bar —
is painted in it either. Without that separation a clay button and an error
badge read as the same class of object, which is the failure this palette
invites.

### Which background a ratio is measured against

Most of these tokens appear on both `--color-ground` and `--color-surface`, and
the two differ. Every ratio in this file is the **worse of the two**, so a
number here holds wherever the token is used. Ivory is `--color-ground` in
light mode, `#FAF9F5`; the dark ground is `#1A1918`. Where a column says "on
Ivory" or "on dark" the measurement is against the ground specifically, because
the accent tones are specified against the page.

Contrast ratios are the WCAG 2.x relative-luminance formula throughout.

## Colour — ground and surface, fixed

Anthropic's warm grey ramp. Never substitute a cool or neutral grey: the warmth
is what makes Ivory read as paper rather than as an unstyled page.

| Token                    | Light                           | Dark                         | Worst-bg ratio | Role                                                                                                                |
| ------------------------ | ------------------------------- | ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--color-ground`         | `#FAF9F5`                       | `#1A1918`                    | —              | Page. Never `#FFFFFF` in light.                                                                                     |
| `--color-surface`        | `#FFFFFF`                       | `#262624`                    | —              | Cards, panels, table bodies.                                                                                        |
| `--color-surface-hover`  | `rgba(115,114,108,.10)`         | `rgba(245,244,237,.08)`      | —              | Row hover _and_ selected row. Selection is a state, so it lives here and not on the accent.                         |
| `--color-rule`           | `rgba(31,30,29,.15)`            | `rgba(245,244,237,.12)`      | —              | Default 1px border and divider. Decorative, not a control boundary.                                                 |
| `--color-rule-strong`    | `rgba(31,30,29,.30)`            | `rgba(245,244,237,.26)`      | —              | Table head underline, section edge. Not an input border: it composites to 1.90 light and 2.25 dark.                 |
| `--color-control-border` | `rgba(31,30,29,.60)`            | `rgba(245,244,237,.45)`      | 4.31 / 3.98    | The resting border of an input, select, checkbox or secondary button. Clears the 3:1 of WCAG 1.4.11 in both themes. |
| `--color-overlay-scrim`  | `rgba(20,20,19,.45)`            | `rgba(0,0,0,.62)`            | —              | Behind a dialog.                                                                                                    |
| `--shadow-overlay`       | `0 8px 24px rgba(20,20,19,.16)` | `0 8px 24px rgba(0,0,0,.50)` | —              | Dialogs and menus only, over `--color-overlay-scrim`. Cards, tables and banners cast nothing.                       |

## Colour — text, fixed

Each ratio is the worse of the token on `--color-ground` and on
`--color-surface`. All four clear AA for body text; the muted step is the floor
for text at 12px and above, and below 12px nothing lighter than
`--color-text-secondary` is used.

| Token                    | Light     | Worst bg | Dark      | Worst bg | Role                                                                                                                              |
| ------------------------ | --------- | -------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--color-text`           | `#141413` | 17.50    | `#F5F4ED` | 13.75    | Figures, names, headings.                                                                                                         |
| `--color-text-secondary` | `#4D4C48` | 8.16     | `#C2C0B6` | 8.31     | Body copy inside a banner or card; any text below 12px.                                                                           |
| `--color-text-muted`     | `#73726C` | 4.58     | `#9C9A92` | 5.38     | Labels, units, column heads, unpriced rows. 12px and up only.                                                                     |
| `--color-text-inverse`   | `#FAF9F5` | 17.50    | `#141413` | 16.72    | On a solid `--color-text` fill, the one non-accent fill in the system: `#FAF9F5` on `#141413` light, `#141413` on `#F5F4ED` dark. |

## Colour — accent, derived from a seed

The seed is one hex value. `@material/material-color-utilities` turns it into a
tonal palette, and five painted tokens read fixed tones off that palette. The
exact call is `CorePalette.of(argbFromHex(seed)).a1.tone(n)`, one call per tone.
A sixth token stores the seed itself and is never painted.

Because contrast in HCT follows tone rather than hue, the six presets land
within a few hundredths of each other at any given tone — but they are not
identical, and a seed outside the preset set can fall outside the ranges below.
Both tables give the spread.

| Token                    | Light               | Dark                | Role                                                                                      |
| ------------------------ | ------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `--color-accent-fill`    | tone 60             | tone 60             | Primary button, active nav underline, primary chart series, focus ring.                   |
| `--color-accent-on-fill` | tone 10             | tone 10             | Text and icons on `--color-accent-fill`.                                                  |
| `--color-accent-text`    | tone 40             | tone 80             | Links and accent-coloured text on the ground.                                             |
| `--color-accent-border`  | tone 50             | tone 50             | 1px edge on every accent fill, and the focused control's border.                          |
| `--color-accent-subtle`  | tone 95             | tone 20             | The quiet accent panel, and nothing else. Not selection: that is `--color-surface-hover`. |
| `--accent-seed`          | the raw hex, stored | the raw hex, stored | Shown in the settings field. Never painted, so it is not a `--color-*` token.             |

### The six presets, resolved

Real output from material-color-utilities 0.4.0, not estimates. Clay is the
default and is not a special case: its seed goes through the same call as any
other. The last row is not a preset — it is the worst out-of-sample seed found,
and it is here because it breaks a bound.

| Preset          | Seed      | fill 60   | on-fill 10 | text 40   | text 80   | border 50 | subtle 95 | subtle 20 |
| --------------- | --------- | --------- | ---------- | --------- | --------- | --------- | --------- | --------- |
| Clay            | `#D97757` | `#DA7453` | `#390B00`  | `#9B4427` | `#FFB59E` | `#BA5C3D` | `#FFEDE8` | `#5D1800` |
| Blue            | `#6A9BCC` | `#4A96D8` | `#001D34`  | `#00629E` | `#99CBFF` | `#287CBC` | `#E8F1FF` | `#003355` |
| Olive           | `#788C5D` | `#759C42` | `#102000`  | `#456813` | `#A9D472` | `#5C822B` | `#D3FF99` | `#1F3700` |
| Aqua            | `#2E9191` | `#00A1A1` | `#002020`  | `#006A6A` | `#4CDADA` | `#008585` | `#ADFFFE` | `#003737` |
| Violet          | `#6B4D9E` | `#A181D8` | `#270058`  | `#6D4EA1` | `#D5BBFF` | `#8667BC` | `#F7EDFF` | `#3D1C70` |
| Fig             | `#C46686` | `#D57193` | `#3E001D`  | `#984061` | `#FFB1C8` | `#B75879` | `#FFECEF` | `#5E1132` |
| (out-of-sample) | `#FFFF00` | `#969600` | `#1D1D00`  | `#626200` | `#CDCD00` | `#7B7B00` | `#F9F900` | `#323200` |

### The same seeds, measured

WCAG 2.x ratios. Accent tones are specified against the page, so these are
measured against the ground: Ivory `#FAF9F5` in light, `#1A1918` in dark.

| Preset                    | fill/on | 60 on Ivory | 60 on dark | 40 on Ivory | 80 on dark | 50 on Ivory | 50 on dark |
| ------------------------- | ------- | ----------- | ---------- | ----------- | ---------- | ----------- | ---------- |
| Clay                      | 5.41    | 3.02        | 5.52       | 6.13        | 10.33      | 4.25        | 3.92       |
| Blue                      | 5.42    | 3.00        | 5.56       | 6.15        | 10.32      | 4.24        | 3.93       |
| Olive                     | 5.36    | 3.02        | 5.51       | 6.15        | 10.32      | 4.26        | 3.92       |
| Aqua                      | 5.39    | 3.01        | 5.53       | 6.10        | 10.32      | 4.25        | 3.92       |
| Violet                    | 5.42    | 3.00        | 5.56       | 6.12        | 10.35      | 4.26        | 3.91       |
| Fig                       | 5.41    | 3.01        | 5.53       | 6.15        | 10.35      | 4.25        | 3.92       |
| (out-of-sample) `#FFFF00` | 5.42    | 2.99        | 5.57       | 6.10        | 10.31      | 4.26        | 3.91       |

### Three numbers to know before using these

**Tone 60 against the ground measures 3.00 to 3.02 across the presets, and 2.99
for a fully saturated yellow seed.** So an accent fill never carries its own
boundary. _Every_ accent fill takes a 1px `--color-accent-border`, whatever it
sits on — not only the ones that sit on the ground.

**Tone 50 measures 4.24 to 4.26 on Ivory and 3.91 to 3.93 on the dark ground**
across the six presets. That is why `--color-accent-border` is tone 50 in both
themes: tone 40, the old dark value, measures 2.71 to 2.73 on the dark ground
and fails the 3:1 of WCAG 1.4.11 on the very token that is supposed to rescue
thin accent edges.

**Tone 40 on the dark ground measures 2.71 to 2.73.** That is why
`--color-accent-text` is asymmetric. Using one value for both themes puts
accent-coloured links below AA at night in every preset.

### CorePalette saturates a near-neutral seed

`CorePalette.of()` builds `a1` with a floor under primary chroma, so the ramp it
returns is never the grey you typed. Measured: a seed of `#808080` has HCT
chroma 1.9, and `a1.tone(60)` comes back `#00A0B0` at chroma 44.9 — a cyan
accent from a grey seed. The settings field must therefore not present the typed
hex as the result: it previews the five resolved tones, and it refuses a seed
whose own chroma is below 16 with a message saying the palette cannot hold a
near-neutral accent.

## Colour — status, fixed and never themed

Five families: four status and a neutral. Each is a base colour plus three
tokens, because the colour a shape is filled with and the colour text is set in
are never the same value: the warning base on Ivory measures 2.19, which is why
`--color-warn-text` is a darker olive and the yellow stays on the border and the
tint while the icon takes the text colour.

Every `-bg` is its family's base at 12% and every `-border` is that base at 32%,
in both themes, with no exceptions. Text ratios are the worse of ground and
surface.

| Family  | Token                  | Light            | Worst bg | Dark             | Worst bg |
| ------- | ---------------------- | ---------------- | -------- | ---------------- | -------- |
| Success | `--color-ok-base`      | `#558A42`        | 3.91     | `#8FBF6A`        | 7.10     |
| Success | `--color-ok-text`      | `#4A7A38`        | 4.82     | `#8FBF6A`        | 7.10     |
| Success | `--color-ok-bg`        | ok-base / 12%    | —        | ok-base / 12%    | —        |
| Success | `--color-ok-border`    | ok-base / 32%    | —        | ok-base / 32%    | —        |
| Warning | `--color-warn-base`    | `#C9A82D`        | 2.19     | `#E0C35A`        | 8.75     |
| Warning | `--color-warn-text`    | `#8A6D0F`        | 4.66     | `#E0C35A`        | 8.75     |
| Warning | `--color-warn-bg`      | warn-base / 12%  | —        | warn-base / 12%  | —        |
| Warning | `--color-warn-border`  | warn-base / 32%  | —        | warn-base / 32%  | —        |
| Error   | `--color-bad-base`     | `#B3332B`        | 5.82     | `#F08A7E`        | 6.24     |
| Error   | `--color-bad-text`     | `#B3332B`        | 5.82     | `#F08A7E`        | 6.24     |
| Error   | `--color-bad-bg`       | bad-base / 12%   | —        | bad-base / 12%   | —        |
| Error   | `--color-bad-border`   | bad-base / 32%   | —        | bad-base / 32%   | —        |
| Info    | `--color-info-base`    | `#2A78D6`        | 4.19     | `#7FB0E8`        | 6.70     |
| Info    | `--color-info-text`    | `#1F5FAD`        | 6.04     | `#7FB0E8`        | 6.70     |
| Info    | `--color-info-bg`      | info-base / 12%  | —        | info-base / 12%  | —        |
| Info    | `--color-info-border`  | info-base / 32%  | —        | info-base / 32%  | —        |
| Neutral | `--color-quiet-base`   | `#73726C`        | 4.58     | `#B0AEA5`        | 6.82     |
| Neutral | `--color-quiet-text`   | `#5E5D59`        | 6.26     | `#B0AEA5`        | 6.82     |
| Neutral | `--color-quiet-bg`     | quiet-base / 12% | —        | quiet-base / 12% | —        |
| Neutral | `--color-quiet-border` | quiet-base / 32% | —        | quiet-base / 32% | —        |

### Colour is never the only carrier

Every banner has an icon whose shape says which family it is: a circle for
info, a tick for success, a triangle for warning, a cross for error. Every delta
carries a glyph, ▲ ▼ —, alongside the colour. A reader who cannot separate the
green from the red still reads the direction.

## Type

Three families, each with a job. Mono carries every number, label and
identifier, because this is a product about machine output and a figure that
shifts column as it changes width is a figure nobody trusts. Sans carries prose.
Serif appears on the marketing site and nowhere in the dashboard.

| Token          | Stack                                                                    | How it is served                                      |
| -------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `--font-mono`  | `'JetBrains Mono', ui-monospace, 'SF Mono', Monaco, monospace`           | SIL OFL 1.1, self-hosted from the Google Fonts files. |
| `--font-sans`  | `'Instrument Sans', system-ui, 'Segoe UI', Helvetica, Arial, sans-serif` | SIL OFL 1.1, self-hosted from the Google Fonts files. |
| `--font-serif` | `Georgia, 'Times New Roman', serif`                                      | System faces. Nothing is served for the serif step.   |

Anthropic Mono, Anthropic Sans and Anthropic Serif may replace the first entry
of each stack in any deployment licensed for them; no other value changes, and
the metrics of the stacks above are what the layout is built on.

### The scale

| Step       | Family | Size / line-height / weight | Letter-spacing | Example use                                        |
| ---------- | ------ | --------------------------- | -------------- | -------------------------------------------------- |
| figure-xl  | mono   | 34 / 1.1 / 700              | -.02em         | `$1,284.60`                                        |
| figure-lg  | mono   | 20 / 1.2 / 700              | 0              | `14,802`                                           |
| figure     | mono   | 13 / 1.4 / 400              | 0              | `$418.02 · 1,204 Turns`                            |
| label      | mono   | 11 / 1.3 / 500              | .08em, caps    | `ESTIMATED COST / SEPTEMBER`                       |
| micro      | mono   | 10 / 1.3 / 400              | .08em          | `41 Turns unpriced`                                |
| heading-lg | sans   | 20 / 1.3 / 600              | 0              | `Members`                                          |
| heading    | sans   | 15 / 1.35 / 600             | 0              | `Org logo`                                         |
| body       | sans   | 14 / 1.5 / 400              | 0              | Prose in a banner or a card.                       |
| caption    | sans   | 12 / 1.4 / 400              | 0              | `SVG or PNG, transparent, square, at least 128px.` |
| display    | serif  | 38 / 1.15 / 400             | 0              | Marketing headline only.                           |

Letter-spacing is 0 everywhere except three steps: label and micro at .08em, and
figure-xl at -.02em. Numerals sit on `font-variant-numeric: tabular-nums`
wherever digits stack in a column.

## Space, radius, focus

A 4px base. Eight steps — 4, 8, 12, 16, 20, 24, 32, 48 — and a layout that needs
a ninth is a layout to revisit.

| Token           | Value                              | Role                                                                                                                                |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `--spacing`     | 0.25rem (4px)                      | Tailwind's base multiplier. Every step below is a multiple of it.                                                                   |
| 1 · 2 · 3       | 4px · 8px · 12px                   | Inside a control: icon gap, label gap, input padding.                                                                               |
| 4 · 5 · 6       | 16px · 20px · 24px                 | Card padding, gaps between cards, table cell padding.                                                                               |
| 8 · 12          | 32px · 48px                        | Between sections, and above a page heading.                                                                                         |
| `--radius-sm`   | 2px                                | Badges, chart bar caps.                                                                                                             |
| `--radius-md`   | 4px                                | Everything else: buttons, inputs, cards, banners.                                                                                   |
| `--radius-full` | 9999px                             | Avatars only.                                                                                                                       |
| `--control-h`   | 36px pointer / 44px at phone width | Every control's height. No component sets its own. Not a Tailwind namespace, so it is a plain custom property read through `var()`. |

Focus is a 3px outline in `--color-accent-fill` at full strength with a 1px
offset, plus `--color-accent-border` on the control itself. At full strength the
ring measures 3.00 to 3.02 against Ivory and 5.51 to 5.56 against the dark
ground across the six presets; the earlier 35% version composited to 1.44 and
1.75 and was not a visible ring at all. It is never removed, and it never relies
on the accent alone: the border changes from `--color-control-border` to
`--color-accent-border` as well, so a monochrome display still shows the focused
control.

## How it is expressed

Tailwind 4 is CSS-first, so the fixed half is a `@theme` block and the derived
half is a set of custom properties written onto `<html>` at render time. No
token lives in JavaScript, and no component reads a raw hex.

The repo has no Tailwind dependency and no such file yet. Ticket 20 adds
`tailwindcss` 4.3.3 and `@tailwindcss/postcss` 4.3.3, the PostCSS config they
need, and `apps/web/app/globals.css`, which is where the block below lands.

```css
@import 'tailwindcss';

/* dark: must follow BOTH the system preference and a forced data-theme.
   Tailwind's built-in dark: variant is prefers-color-scheme only, so a
   Member who forces light would get dark components on a light ground. */
@custom-variant dark {
  @media (prefers-color-scheme: dark) {
    &:where(
      :root:not([data-theme='light']),
      :root:not([data-theme='light']) *
    ) {
      @slot;
    }
  }
  &:where([data-theme='dark'], [data-theme='dark'] *) {
    @slot;
  }
}

/* `static` because several tokens (--control-h, the accent set) are read
   through hand-written var() rather than through a generated utility, and
   Tailwind otherwise emits only the theme variables it sees used. */
@theme static {
  --color-ground: #faf9f5;
  --color-surface: #ffffff;
  --color-text: #141413;
  --color-text-muted: #73726c;
  --color-control-border: rgba(31, 30, 29, 0.6);
  --color-ok-base: #558a42;
  /* ...the rest of the fixed set... */

  /* the derived half, pointed at the properties the server writes inline */
  --color-accent-fill: var(--accent-fill);
  --color-accent-on-fill: var(--accent-on-fill);
  --color-accent-border: var(--accent-border);
  --color-accent-text: var(--accent-text);
  --color-accent-subtle: var(--accent-subtle);
}

:root {
  color-scheme: light;
  --accent-text: var(--accent-text-light);
  --accent-subtle: var(--accent-subtle-light);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --color-ground: #1a1918;
    --color-surface: #262624;
    --color-text: #f5f4ed;
    --color-text-muted: #9c9a92;
    --color-control-border: rgba(245, 244, 237, 0.45);
    --color-ok-base: #8fbf6a;
    --accent-text: var(--accent-text-dark);
    --accent-subtle: var(--accent-subtle-dark);
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --color-ground: #1a1918;
  --color-surface: #262624;
  --color-text: #f5f4ed;
  --color-text-muted: #9c9a92;
  --color-control-border: rgba(245, 244, 237, 0.45);
  --color-ok-base: #8fbf6a;
  --accent-text: var(--accent-text-dark);
  --accent-subtle: var(--accent-subtle-dark);
}
```

That is the three-state theming: a light default on `:root`, a dark branch under
`prefers-color-scheme` guarded by `:root:not([data-theme="light"])` so a Member
who forces light keeps it, and a third rule for `:root[data-theme="dark"]` so a
Member who forces dark gets it on a light system.

### How the derived accent properties land on `<html>`

An inline style cannot vary by media query or by attribute, and it outranks
every stylesheet rule, so the three accent values that are the same in both
themes go in under their own names and the two that differ go in twice, under a
`-light` and a `-dark` name. That is **seven properties**, not five. The
stylesheet above, not the inline style, picks between each pair.

```html
<html
  data-theme="dark"
  style="--accent-fill:#DA7453;
             --accent-on-fill:#390B00;
             --accent-border:#BA5C3D;
             --accent-text-light:#9B4427;
             --accent-text-dark:#FFB59E;
             --accent-subtle-light:#FFEDE8;
             --accent-subtle-dark:#5D1800"
></html>
```

The five painted values are computed once when a seed is saved and stored beside
it, not recomputed per request and not computed in the browser. For a signed-out
visitor, and for the _system_ preference, no attribute is written and the media
query decides, so nothing has to run before first paint.

**How a signed-in Member's preference actually arrives (ticket 77).** This page
said the server writes `data-theme` on `<html>`. It does not, and cannot: that
element lives in the root layout every route shares, so reading the session or a
cookie there would opt the whole product out of static prerendering and, under
Cache Components, block every segment beneath it — which is what tickets 80 and
83 exist to deliver. So the resolved theme and the seven properties travel in a
cookie the server writes when the setting changes and at sign-in, and an inline
script in `<head>` applies them while the browser parses the document, before
the first paint. Next's own guidance reaches the same conclusion, in
`preventing-flash-before-hydration.md` § "Storing the theme in a cookie". The
markup above is what the document looks like by the time anything is painted;
it is written by that script rather than rendered by the server. The cookie is
presentation and never authority — it carries no id and no claim, every value
is checked against a shape before it is applied, and the worst a tampered one
can do is recolour that browser's own pages.

## Component inventory

Thirty-seven components across six groups, each with its parts, its states, and
the ticket that first needs it. Ticket references are the first ticket that
needs each one, from the tracker in `.scratch/sessclone-v1/issues/`.

### Four states, everywhere

These are this ticket's rules, and tickets 17 and 18 inherit them — both are
blocked by this one, so neither has to re-decide what a loading or an empty
state looks like. Two rules, not one: every component that renders a Cost
implements the unpriced state, and every component that renders fetched data
implements loading, empty and error. A component that cannot be empty says so
explicitly.

| State    | Rule                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading  | A skeleton in the shape of the content, never a spinner. A spinner appears in one place only: inside a button that is submitting.                 |
| Empty    | Headline, one sentence, and the action that ends it. A new Org's empty dashboard tells the Owner to install the Collector.                        |
| Error    | What failed, in the reader's terms, and a retry. Never a status code alone.                                                                       |
| Unpriced | Counted and labelled, wherever a Cost is rendered. A Turn whose model has no Rate is excluded from the total and said so, never rendered as zero. |

**Cost never appears alone.** Tickets 18 and 52 both require token counts beside
Cost. That is a component, not a habit: `CostWithTokens` renders the money and
the counts as one unit, and no view composes them by hand. If a surface shows a
dollar figure without it, that is a bug with a name. Four token classes are
rendered, because ticket 41 prices four: input, output, cache write and cache
read. The two cache-write tiers are priced separately and summed into the one
figure a reader can act on.

SeedPicker, FileDrop and SegmentedControl all hang off an appearance-and-
branding setting: the Org's default accent seed, the seed lock, a Member's own
seed and light or dark preference, and the Org logo. Ticket 77 owns all of it,
which is what makes the derived half of the token system buildable.

### Frame — 5

| Component   | Parts                                                          | States and variants                                                                                                                                                                                                                                                           | First needed |
| ----------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| AppBar      | Org mark, divider, sessclone wordmark, nav items, account menu | Nav filtered by Role, with the Platform Admin entry gated on the platform flag rather than on any Role, since a Platform Admin holds no Role inside an Org. Active item carries an accent underline, not a fill. Collapses to a menu button under 700px.                      | 45           |
| PageHeader  | Title, one-line description, action slot, control slot         | With and without controls. The date-range control mounts in the control slot rather than floating in the page.                                                                                                                                                                | 45           |
| AccountMenu | Avatar, name, Org name, Role badge, appearance link, sign out  | Open, closed. Keyboard-navigable; Escape closes and returns focus. Ticket 27 signs out from a bare page with no shell around it; the menu itself arrives with the shell at 45.                                                                                                | 45           |
| AdminBar    | A band above the AppBar, platform-admin navigation             | Platform Admin only. Visually distinct so a Platform Admin is never unsure whether they are acting on the deployment or on an Org. Carries the nav for the admin pages ticket 62 opens.                                                                                       | 62           |
| OrgMark     | Uploaded logo, or the Org initial on `--color-quiet-bg`        | 20px nav, 32px sign-in, 24px email, the same 20/24/32 scale as Avatar. Never recoloured, cropped or stretched. Sits on its own tile so a dark logo survives the dark theme. The invite email itself is ticket 49's; the mark is the only piece this inventory shares with it. | 77           |

### Data display — 8

| Component      | Parts                                                                       | States and variants                                                                                                                                                                                                                                                                         | First needed |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Figure         | Label, value, footnote                                                      | Sizes xl and lg. Loading, empty and error. Renders a CostWithTokens for its value and owns no cost logic of its own, so the unpriced rule lives in exactly one place.                                                                                                                       | 52           |
| CostWithTokens | Money, then token counts by class                                           | Inline and stacked. Unknown-cost variant reads "unpriced" and keeps the counts.                                                                                                                                                                                                             | 52           |
| DataTable      | Head, rows, numeric columns, optional selection column, bulk action, footer | Loading skeleton, empty, error, sorted, hover, row link, and row selection with one bulk action — ticket 73 deletes Log Artifacts one Session at a time or a whole Project at once. Numerics right-aligned on tabular figures. Unpriced rows use the neutral tokens, never a status colour. | 28           |
| Pagination     | Range text, previous, next                                                  | First page, last page, single page hides the control.                                                                                                                                                                                                                                       | 28           |
| EntityCell     | Leading slot, name, secondary line                                          | Member, Project, Device. A Member leads with an Avatar; a Project and a Device lead with a monogram tile, since only an Org has a mark. Device shows its nickname with its identity beneath.                                                                                                | 46           |
| ChartFrame     | Title, direct series labels, plot, axes, hover readout, caveat line         | Loading, empty, error, partial-bucket, unpriced annotation. Series colours below.                                                                                                                                                                                                           | 52           |
| CodeBlock      | Command text, copy button                                                   | One line and multi-line. Copied confirmation. Used by the Collector install path.                                                                                                                                                                                                           | 45           |
| SecretField    | Full value at creation, prefix afterwards, copy                             | Ticket 28 stores only a hash and a short prefix, so the full value is shown once at creation and only the prefix exists afterwards. There is no reveal control — there is nothing to reveal. Copy is the primary action at creation, because the value will not be shown again.             | 28           |

### Controls — 13

| Component        | Parts                                                       | States and variants                                                                                                                                                                                  | First needed |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Button           | Label, optional icon                                        | Primary, secondary, ghost, danger. Sizes sm and md. Hover, focus, disabled, submitting, icon-only with an aria-label.                                                                                | 26           |
| TextLink         | Text                                                        | An `<a href>` in accent text, for anything that navigates. Named so nobody reaches for a button plus a router call.                                                                                  | 26           |
| SegmentedControl | Two to four options                                         | Light, dark or system, and nothing else. Selected segment takes the accent fill.                                                                                                                     | 77           |
| DateRangeControl | Preset list, custom range, applied summary                  | Preset selected, custom open, invalid range. Reads and writes the URL so a view is shareable, and resolves in the Org's timezone. Built once; every breakdown inherits it.                           | 53           |
| Select           | Trigger, listbox                                            | Open, closed, disabled, no-options. Native under the hood. First used to pick a Role when inviting, then for the retention window an Owner chooses under the Tier ceiling in ticket 61.              | 49           |
| TextField        | Label, input, hint, error                                   | Default, focused, invalid, disabled, read-only. The label is a real `<label>`; the error is announced, not merely coloured.                                                                          | 27           |
| Switch           | Track, thumb, label, description                            | Archival opt-in, the Org's appearance lock, and ticket 65's per-Tier capability toggles. Off is always the safe value.                                                                               | 72           |
| Checkbox         | Box, label                                                  | Checked, unchecked, indeterminate, disabled. Per-project archival exclusions.                                                                                                                        | 72           |
| SeedPicker       | Six preset swatches, custom swatch, hex field, live preview | Preset selected, custom seed, invalid hex, locked by the Org. Each swatch is a real button with an aria-label.                                                                                       | 77           |
| FileDrop         | Drop target, current file, replace                          | Empty, holding a file, rejected format, too small, uploading. The Org logo only.                                                                                                                     | 77           |
| Form             | Fieldset, fields, error summary, submit row                 | Idle, submitting, field-invalid, submission-failed. Composes TextField, Select and DateField into something submittable, so every editable surface uses one thing rather than wiring inputs by hand. | 27           |
| DateField        | Label, native date input, hint                              | One date, not a range: effective dates on Rates and overrides. Distinct from DateRangeControl, which also reads and writes the URL.                                                                  | 63           |
| CopyButton       | Icon, confirmation                                          | Idle, copied. Confirmation is text as well as colour.                                                                                                                                                | 45           |

Controls are 36px tall on a pointer and 44px at phone width, both multiples of
the 4px base. The token is `--control-h`; no component hardcodes a height.

### Feedback — 5

| Component  | Parts                                  | States and variants                                                                                                                                                                                                                                                                                                                              | First needed |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Banner     | Icon, title, body, optional action     | Info, success, warning, error. Dismissible and permanent. The icon's shape carries the family independently of its colour.                                                                                                                                                                                                                       | 45           |
| Badge      | Text                                   | Active, inactive, unpriced, and a neutral variant that carries a Role. No trial and no past-due: ticket 48 is manual activation with no payment rail, so nothing could ever set them.                                                                                                                                                            | 28           |
| Dialog     | Header, body, footer actions           | Confirm, destructive-confirm, and form. A destructive dialog names the object in the button, never "Confirm". Focus trapped, Escape closes, focus returns.                                                                                                                                                                                       | 28           |
| EmptyState | Headline, one sentence, primary action | Per surface, and a whole-surface variant that tells a deactivated Org it is inactive rather than showing it a broken dashboard (ticket 48). That variant uses the neutral tokens, not a status colour: deactivation is an ordinary state, not a failure. Day-one variants for the dashboard, Members, Projects, Devices, keys and Log Artifacts. | 45           |
| Skeleton   | Blocks matching the content            | Figure, table row, chart. Respects `prefers-reduced-motion`; no shimmer when it is set.                                                                                                                                                                                                                                                          | 45           |

### Identity and authority — 2

| Component    | Parts                          | States and variants                                                                                                 | First needed |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------ |
| Avatar       | Initial on a warm-grey tile    | Sizes 20, 24, 32. No uploaded Member photos in v1, so no image variant to build.                                    | 45           |
| ScopeSummary | Count, member list, empty case | A Manager's Scope, including the empty Scope that sees nobody, which is a real and confusing state worth designing. | 46           |

### Marketing — 4

The public site shares every control and every colour token with the dashboard,
and adds one display step: a serif face for headlines. The accent is always Clay
for a signed-out visitor, who has no Org and so no seed to apply — but light and
dark still follow the visitor's own preference, which ticket 77 requires on the
marketing site too.

| Component      | Parts                                                | States and variants                                                                                                                                                                                                                  | First needed |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| MarketingFrame | Nav, footer, repository link                         | Phone through desktop, both themes.                                                                                                                                                                                                  | 26           |
| Hero           | Serif headline, sub, install command, primary action | The collection-across-environments claim is the headline, so the CodeBlock is part of the hero rather than below it.                                                                                                                 | 26           |
| TierCard       | Name, per-seat price, included list, action          | Default, highlighted, self-hosted. The self-hosted card is free and says so plainly, because it is the honest path and pretending otherwise costs trust. Ticket 47 reuses it signed in, where the Owner sees the Tier the Org is on. | 26, 47       |
| ClaimBlock     | Heading, prose, supporting visual                    | Text-left and text-right, alternating. Never more than one accent element per block.                                                                                                                                                 | 26           |

### Deliberately not on this list

- **No component library.** Nothing here needs a dependency. Every one of these
  is markup plus tokens, and ticket 20 decides the shape.
- **No tab component.** Navigation exists — it lives in AppBar, and a page's own
  controls live in PageHeader's control slot. What is deferred is a tab
  component, because the map of surfaces is ticket 17's to decide and a tab
  component first would decide it by accident.
- **No date-picker dependency.** Presets plus two native date inputs cover
  ticket 53. A calendar widget is a lot of surface for the rare custom range.
- **No standalone Tooltip.** ChartFrame keeps its hover readout, but nothing
  lives only there: every value the readout shows also renders in the table row
  beneath the chart or in its caption. A touch device and a screenshot get the
  same numbers, just not on hover.
- **No Sparkline.** Tickets 54, 55 and 56 ask for Cost and tokens over the
  selected range, not an in-row trend. Bring it back when a ticket asks.
- **No SearchField.** The v1 lists are bounded and already ordered by the thing
  a reader came for, and Pagination covers the long ones. Search is not a control
  so much as a decision about what is indexed and what is matched, which is a
  larger piece of work than the field it hides behind.
- **No RolePill.** It was Badge with neutral tokens and a Role in it. The rule
  survives — a Role is not a status and never takes a status colour — as a rule
  rather than a second component that drifts from the first.
- **No Member photos.** Avatars are initials. Photo upload is storage,
  moderation and a privacy question nobody has asked for.
- **No dark-mode-only or light-mode-only component.** Anything that cannot be
  drawn in both is not finished.

### Accessibility, as component rules

- **Real elements.** Buttons are `<button>`, links are `<a href>`, fields have a
  `<label>`. No handler on a div, in mockups either.
- **Focus is never removed.** A 3px accent outline plus a border change, so the
  focused control is visible without relying on the accent alone.
- **Shape with colour.** Banners carry a shape per family, badges carry their
  word, chart series carry a direct label. Colour is a second channel, never the
  first.
- **Motion is optional.** Skeletons and dialogs both check
  `prefers-reduced-motion`.

## Chart colours

Two palettes, not one.

| Case          | Palette                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| One series    | Uses `--color-accent-fill`. Org Cost over time, a single Member's trend. There is nothing to tell it apart from, so the Member's own accent is fine. |
| More than one | Uses the fixed palette below and never the accent. It does not change with the seed, the Org or the Member.                                          |

If series colours came from each viewer's accent, two people looking at the same
breakdown would see different charts and "the green one" would name two
different Members. A chart is a thing colleagues talk about across a desk.

### The palette

Hues are Okabe-Ito's, the categorical set published for colour-blind readers.
Lightness and chroma are not: they were searched per theme under hard
constraints, because Okabe-Ito's published values do not clear 3:1 on a light
ground.

Light theme — ground `#FAF9F5`, panel surface `#FFFFFF`:

| Slot                   | Hue            | Value     | vs ground | vs surface |
| ---------------------- | -------------- | --------- | --------- | ---------- |
| `--color-series-1`     | orange         | `#A98C66` | 3.01      | 3.17       |
| `--color-series-2`     | bluish green   | `#15513C` | 8.77      | 9.23       |
| `--color-series-3`     | yellow         | `#6A6601` | 5.67      | 5.98       |
| `--color-series-4`     | blue           | `#118FDC` | 3.33      | 3.51       |
| `--color-series-5`     | reddish purple | `#B52082` | 5.71      | 6.01       |
| `--color-series-other` | neutral        | `#8F9192` | 3.01      | 3.17       |

Dark theme — ground `#1A1918`, panel surface `#262624`:

| Slot                   | Hue            | Value     | vs ground | vs surface |
| ---------------------- | -------------- | --------- | --------- | ---------- |
| `--color-series-1`     | sky blue       | `#85CFFE` | 10.33     | 8.92       |
| `--color-series-2`     | bluish green   | `#307D60` | 3.53      | 3.05       |
| `--color-series-3`     | yellow         | `#979009` | 5.27      | 4.55       |
| `--color-series-4`     | vermillion     | `#F9C7AB` | 11.52     | 9.95       |
| `--color-series-5`     | reddish purple | `#E511A3` | 4.13      | 3.57       |
| `--color-series-other` | neutral        | `#B3B4B8` | 8.47      | 7.32       |

A chart sits on a panel, and the panel sits on the page, so every value clears
3:1 against both. The two backgrounds differ by only 1.05:1 in light and 1.16:1
in dark, but the binding one is the page in light and the panel in dark, and
taking the easier of the two is how the previous draft shipped a dark green at
2.83 against the panel it was drawn on. Slots are assigned by value, largest
first, so the biggest spender is always series 1 and Other is always last.

### What the search found

Hue was fixed to an Okabe-Ito angle and only lightness and chroma varied. Hard
constraints: at least 3:1 against both the ground and the panel surface, chroma
at or above 25, and lightness inside a band, because an unbanded search returns
a near-black purple beside a near-white green, which wins the metric and loses
the chart. The objective was the largest achievable minimum CIEDE2000 across
normal vision and all three dichromacies at once. Simulations are Brettel,
Viénot and Mollon 1997, the two-half-plane projection, applied in linear sRGB,
with matrices taken verbatim from libDaltonLens. Distances are CIEDE2000,
verified against the Sharma, Wu and Dalal 2005 test data to within 1e-4.

| Series | Worst pair, light | Worst pair, dark | Verdict                                       |
| ------ | ----------------- | ---------------- | --------------------------------------------- |
| 4      | 32.18             | 28.95            | Comfortable, unbanded.                        |
| 5      | 18.73             | 20.04            | Chosen. With Other included, 16.06 and 16.41. |
| 6      | 15.29             | 17.97            | Possible, not taken.                          |

The five-series numbers are the series against each other; the number that
governs the product is the one with the neutral included, since Other is on the
chart. Light's worst pair is series 1 against Other under protanopia, dark's is
series 5 against Other under deuteranopia. Those are the numbers to quote.

**Six is available if the product needs it.** Six clears 15.29 in light and
17.97 in dark, comfortably above the reference point below, and the values are
in the working notes. It is not taken because the top slots are the ones a
reader cares about, a sixth hue costs about 3.5 in light, and a breakdown with
six categories is usually a breakdown that wanted five and a rollup.

### There is no published floor, and this file will not invent one

No standards body publishes a minimum colour difference for categorical
palettes. CIEDE2000 is defined for small differences and recommends its own use
in the 0 to 5 range. WCAG never measures colour difference at all: 1.4.11 is a
luminance ratio and 1.4.1 asks for a non-colour cue without giving a number. The
"brightness 125, colour 500" pair that circulates comes from a 1999 W3C working
draft that was never normative.

The strongest published reference point is ΔE00 of 10, from Brychtová and
Çöltekin's 2017 study of colour discriminability in maps, and adopted as a hard
constraint by Palettailor in 2021. It is a sufficiency result rather than a
demonstrated minimum, since 10 was the largest distance that study tested.
Required difference also scales with mark size, so a palette that is safe on a
bar is not automatically safe on a one-pixel line. That ΔE00 of 10 figure is
taken from the abstract and secondary reporting of Brychtová and Çöltekin; its
results section has not been read directly.

What this palette claims: worst-case separation over normal vision and all three
dichromacies, including the neutral, is 16.06 in light and 16.41 in dark. That
is above the strongest published reference point, measured rather than asserted,
and it is the whole claim.

### Everything in a chart that is not a series

| Thing          | How it is drawn                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| partial bucket | The series colour, striped with the theme's ground colour at full opacity, and the axis label says "today". Never a different colour: a bucket still filling is the same data, not another category. |
| unpriced       | The same stripe on `--color-series-other`, with the count of Turns that have no Rate named in the line under the chart, and the same count in the table. Never omitted, never drawn at zero.         |
| grid lines     | `--color-rule`. Horizontal only, and only where a labelled tick sits.                                                                                                                                |
| axis text      | `--color-text-secondary` at the mono label step.                                                                                                                                                     |
| baseline       | `--color-rule-strong`, so zero is unambiguous.                                                                                                                                                       |
| reference line | `--color-text-secondary`, dashed, labelled at its right end.                                                                                                                                         |
| hover readout  | A `--color-surface` panel carrying the bucket, the Cost and the token counts. Every value in it also appears in the table under the chart, so a touch device and a screenshot lose nothing.          |

**Why the stripe is the ground colour at full opacity.** An opaque stripe of the
ground composited over a fill is the ground, so its contrast against that fill is
exactly the fill's contrast against the ground, which is already a hard
constraint of this palette. One rule covers both themes and cannot quietly break
when a series changes: the worst case is 3.01 in light and 3.53 in dark, the
same numbers as the tables above. The previous draft used white at 55%, which
measured 1.34 against the dark yellow. That was a wash, not a pattern.

### Chart rules

- **Label the series where it is.** A name sits at the height of its own
  segment. A legend makes the reader hold a colour in memory while their eye
  travels, which is the exact task colour blindness makes hard.
- **Five, then Other.** A breakdown with twenty Members shows the top five and
  rolls up the rest. The table under the chart carries every row, and that table
  is part of the chart, not an extra.
- **Order is meaning.** Slots go by value descending and stacks build in the
  same order, so position works as a second channel for free.
- **Never a rainbow ramp.** No continuous scale for categories and no colour per
  Member beyond the five. A twenty-hue chart is unreadable to everyone.
- **Cost carries its tokens.** Every readout and every caveat line uses
  CostWithTokens, like the rest of the product.
- **Charts render in both themes.** Series colours come from tokens, so a chart
  takes the viewer's theme like everything else.

## Known sharp edges

**material-color-utilities 0.4.0 will not load under bare Node.** Its published
ESM uses extensionless imports, so `node` throws `ERR_MODULE_NOT_FOUND` on
`dynamiccolor/dynamic_scheme` the moment the package root is imported. A
standalone script, a migration or a test that reaches for it needs a bundler;
every accent number in this file was produced by bundling it with esbuild first.

**3.00 is no margin at all.** The worst preset — Blue and Violet both — puts
tone 60 at exactly 3.00 against Ivory, which is the requirement met with nothing
to spare, and an out-of-sample seed goes under: a fully saturated yellow lands at
2.99. So the fill is never treated as carrying its own boundary. The
`--color-accent-border` rule is not decoration, and it is unconditional: a fill
that drops it is out of compliance for some seed already in the preset list,
never mind the ones a Member can type.

**Two chart values sit exactly on the floor.** Light series 1 and the light
neutral both measure 3.01 against the page. There is no margin there, and the
stripe rule inherits it: darkening either one below 3:1 breaks the hatch and the
palette together. That coupling is deliberate, but it means these two values are
not free to be nudged for taste.

**The light theme has less room than the dark one.** A colour at chroma 25 or
more cannot clear 3:1 against a white panel above about lightness 60, so the
usable light band is 30 points wide where dark's is 40. That single ceiling is
why light scores lower than dark at every series count, and it is not something
a better search can fix.

**The stripe needs room to read as a stripe.** Below roughly 16px of segment
height a 45° stripe at a 5px period reads as a tint rather than a pattern, which
is the one reading this system forbids. A stack segment under that height
carries the state in the row and the caveat line instead, and never in the fill
alone.

**These are the best palettes found, not proven optima.** The search is a
coordinate descent with basin hopping over every hue subset, run from several
seeds. More restarts can only raise the numbers; three runs moved them by under
one unit. Treat the figures as lower bounds.

**Recharts draws it and does not decide it.** The spec pins recharts 3.10.1,
current and not deprecated. The palette reaches it as an array of CSS variables,
so nothing here is library-specific.

## References

- Simulations: Brettel, Viénot and Mollon, "Computerized simulation of color
  appearance for dichromats", JOSA A 14(10), 1997.
- Reference point: Brychtová & Çöltekin, "The effect of spatial distance on the
  discriminability of colors in maps", CaGIS 44(3):229–245,
  doi:10.1080/15230406.2016.1140074; Lu et al., "Palettailor: Discriminable
  Colorization for Categorical Data", IEEE TVCG 27(2):475–484,
  doi:10.1109/TVCG.2020.3030406.
- On size dependence: Stone, Szafir & Setlur, CIC22, 2014,
  doi:10.2352/CIC.2014.22.1.art00045; Szafir, IEEE TVCG 24(1):392–401,
  doi:10.1109/TVCG.2017.2744359.
- Accent values generated with `@material/material-color-utilities` 0.4.0 via
  `CorePalette.of(argb).a1.tone(n)`. Palette from Anthropic's brand colour
  system.
