import { z } from 'zod'

import { IngestPayload, IngestResponse } from './ingest.ts'

// Ticket 117. The ingest API as OpenAPI 3.1, built from the zod schemas the
// route validates against, so the reference cannot describe a payload the
// route does not accept. `openapi/ingest.json` is this function's output,
// checked in; `openapi.test.ts` fails when the two differ, and regenerates it
// with `pnpm vitest run packages/shared/src/openapi.test.ts -u`.
//
// OpenAPI 3.1's schema object is JSON Schema 2020-12, which is zod's default
// target, so the schemas go in as zod writes them. Refinements (`must not be
// blank`, "at least one report, failure or session end") have no JSON Schema
// form and are carried in the prose instead.
//
// One document per API. The transcript and MCP APIs, when they exist, are
// documents of their own beside this one, not paths added to it: they are
// authenticated differently and versioned separately.

const schema = (type: z.ZodType, io: 'input' | 'output') => {
  // `$schema` is implied by `openapi: 3.1.0`; repeating it in every component
  // is noise in the rendered reference.
  const { $schema: _, ...rest } = z.toJSONSchema(type, { io })
  return rest
}

/** Every refusal the route writes: `{ error, detail? }`. */
const ErrorBody = z.object({
  error: z.string(),
  detail: z.string().optional(),
})

const errorResponse = (description: string) => ({
  description,
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/Error' } },
  },
})

export const ingestOpenAPI = () => ({
  openapi: '3.1.0',
  info: {
    title: 'sessclone ingest',
    version: '1',
    description:
      'The endpoint the Collector reports Turns to. Self-hosted: the base URL is your own deployment.',
  },
  // Relative: the docs are served by the deployment they document, so the
  // playground and the code samples resolve it against the page's origin.
  servers: [{ url: '/', description: 'This deployment' }],
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: {
      apiKey: {
        type: 'http',
        scheme: 'bearer',
        description:
          'A Member API key, `sk_…`, created on the Keys page of the dashboard. It decides the Member and the Org every Turn is filed under; the payload names neither.',
      },
    },
    schemas: {
      IngestPayload: schema(IngestPayload, 'input'),
      IngestResponse: schema(IngestResponse, 'output'),
      Error: schema(ErrorBody, 'output'),
    },
  },
  paths: {
    '/api/ingest': {
      post: {
        operationId: 'ingest',
        summary: 'Report Turns',
        description: [
          'Reports what one or more transcripts grew by since their cursors. The key is checked before the body is read.',
          '',
          'Idempotent by conflict: re-sending a batch stores nothing twice, and is still acknowledged, so the Collector re-sends rather than skips when a response is lost.',
          '',
          'A batch carries at least one report, failure or session end. Every identifier must be non-blank.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/IngestPayload' },
            },
          },
        },
        responses: {
          '200': {
            description:
              'Accepted. One entry per report, echoing its cursor: advance to it.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/IngestResponse' },
              },
            },
          },
          '400': errorResponse(
            'Not an ingest payload (`detail` names the first problem and its path), or the database refused this batch. Nothing from the batch was written. Do not retry the same bytes.',
          ),
          '401': {
            ...errorResponse(
              'No live API key: missing, malformed, unknown and revoked keys all get this same answer. Stop and check the key.',
            ),
            headers: {
              'WWW-Authenticate': {
                schema: { type: 'string', const: 'Bearer' },
              },
            },
          },
          '503': errorResponse(
            'The database is unavailable. Nothing from the batch was written; queue the batch and retry.',
          ),
        },
      },
    },
  },
})
