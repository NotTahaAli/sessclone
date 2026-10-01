import { jsonLd } from '../../lib/structured-data'

/**
 * A schema.org graph as `<script type="application/ld+json">`, for search
 * results and answer engines (`lib/structured-data.ts`). `jsonLd` escapes
 * `<`, so no text in the graph can close the element early.
 */
export function JsonLd({ graph }: { graph: unknown }) {
  // A new object per render, which the rule is right about in general and
  // wrong about here: this is a server component, so there is no second
  // render to memoise for.
  // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
  const html = { __html: jsonLd(graph) }
  return (
    // oxlint-disable-next-line no-danger
    <script type="application/ld+json" dangerouslySetInnerHTML={html} />
  )
}
