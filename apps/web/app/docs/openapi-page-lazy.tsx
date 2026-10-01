'use client'

import dynamic from 'next/dynamic'

// The playground (Base UI, its forms and their highlighter) is the heaviest
// client code in the docs. Imported straight into `mdx-components.tsx` it
// shipped with every docs page, rendered or not (2026-10-01, Lighthouse);
// behind `next/dynamic` in a client module it is a chunk of its own, loaded
// by the API pages that render it. Still server-rendered.
export const OpenAPIPage = dynamic(() =>
  import('./openapi-page').then((module) => module.OpenAPIPage),
)
