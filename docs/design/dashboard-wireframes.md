# Dashboard wireframes and chart specs

Ticket 18. Settled 2026-09-20. Builds on the information architecture in
`product-ia.md` and the tokens, components and chart palette in
`design-system.md`.

The boards these describe were reviewed at 390 px and 1440 px, in both
themes, before this document was written. Everything a person sees is drawn
here, including the states that are easy to leave to implementation and then
get wrong.

## Which chart answers which question

A chart type is a claim about what the reader should compare. One question,
one chart.

| View | Question | Chart | Why not the obvious alternative |
| --- | --- | --- | --- |
| Costs, over time | Is spend rising, and which model is driving it? | Stacked bars, one per day | A line implies a continuous quantity; spend is a sum over a bucket. Stacking keeps the total readable while the split stays visible. |
| Costs, people | Who spends the most? | Horizontal bars, sorted | A pie cannot be read past four slices and cannot be sorted. |
| Costs, models | What is the mix? | Horizontal bars, sorted, with share shown as a number | Same reason. The number carries the share; the bar carries the ranking. |
| Costs, repos | Which work costs the most? | Horizontal bars, sorted, long names truncated from the middle | Repo names collide at the head and the tail is what distinguishes them. |
| A member or device detail | How does this one behave over time? | Sparkline beside the total | A full chart implies a question the reader did not ask at this level. |
| Cache efficiency | Are we re-sending context? | One number, with the previous period beside it | A chart over time invites a trend reading on a ratio that moves with workload, not with efficiency. |

Five series plus a neutral, per `design-system.md`. A sixth category is
rolled into **Other**, which always takes the neutral and always sorts last,
never by value.

## Layout

**Phone, 390 px.** One column. The header carries the org name and the
account control. Below it the view tabs, then the headline number, then the
chart, then the list. Navigation is a bottom bar of four: Costs, Keys,
Devices, Settings. Nothing is side by side; nothing needs zooming.

**Desktop, 1440 px.** A 232 px sidebar holds the same four destinations and
the account block, and at the bottom of it the self-hosting credit when the
deployment is self-hosted. The content column carries the view tabs, a row of
four summary tiles, then a 12-column grid: the chart spans eight, the ranked
list spans four.

The two widths show the same content in the same order. Nothing appears on
one and not the other.

## The date range

One control, top right of the content header, beside Export. It holds the
range for every Costs view and persists across the tab switch, because the
reader is asking one question about one period and changing the breakdown,
not starting again.

The range lives in the URL, so a link to a view is a link to a period. The
default is the current calendar month, which is the period a bill is drawn
on.

## States that are drawn, not improvised

Every view that renders data carries four.

- **Loading.** The frame, the tabs and the range control render immediately;
  the chart and the list render as blocks at their final height in the panel
  colour. No spinner, and no layout shift when the data lands.
- **Empty, and nothing is wrong.** The range has no turns. The chart area
  carries one sentence saying so and offers the next wider range as a link.
  This is not the onboarding state.
- **Empty, and nothing has ever arrived.** Onboarding, computed from the
  three observed facts in `product-ia.md`. Never reached by a stored step.
- **Error.** What failed, in one sentence, and a retry control. The rest of
  the page stays where it is, so the reader does not lose their place.

## Unpriced turns

A turn whose model has no price yet is real usage with an unknown cost.
Pricing it at zero is a lie and dropping it is a bigger one.

It is drawn as a fixed-height hatched cap in the neutral, detached from the
money axis, and it is named in the legend as **Unpriced**. The hatch is a
stripe of the ground colour at full opacity, which clears 3:1 against any
series that already clears 3:1 against the ground. The count of unpriced
turns appears in the summary tiles; their cost never joins the total.

## Tokens beside cost

Every view that shows Cost shows the token count for the same rows, in the
monospace face, as a secondary value. Cost is derived from tokens and a
price table, and a reader who cannot see the tokens cannot tell a price
change from a usage change.

## Reviewed boards

The canvas used for review holds Costs and Devices at 390 px, Costs at
1440 px, and the onboarding surface at 390 px. The remaining views repeat
these three shapes with a different breakdown, which is the point.
