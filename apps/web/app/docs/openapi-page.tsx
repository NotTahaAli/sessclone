'use client'

import { createOpenAPIPage } from 'fumadocs-openapi/ui'

import PlaygroundClient from '../../components/openapi/playground'

// Ticket 117. The playground is the Fumadocs one, installed as source with
// `@fumadocs/cli add` so its controls can be restyled to Direction A
// (`components/`, `cli.json`); this is where it replaces the built-in one.
export const OpenAPIPage = createOpenAPIPage({
  playground: {
    render: () => <PlaygroundClient writeOnly readOnly={false} />,
  },
})
