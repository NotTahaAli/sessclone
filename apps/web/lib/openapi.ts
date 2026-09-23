import spec from '@sessclone/shared/openapi/ingest.json'
import { createOpenAPI } from 'fumadocs-openapi/server'

// Ticket 117. One document per API, keyed by the id an `OpenAPIPage` names.
// The ingest spec is the checked-in file `packages/shared` generates from its
// zod schemas and tests against them; the transcript and MCP APIs, when they
// exist, are further entries here and further pages under `content/docs/api`.
export const openapi = createOpenAPI({
  // The JSON import is typed by its literal shape (`type: string` where the
  // library wants `'http'`), which TypeScript cannot narrow; the file's
  // validity is `packages/shared`'s test's job, not this cast's.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  input: { ingest: () => spec as never },
})
