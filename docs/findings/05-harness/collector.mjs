// Run OUTSIDE the environment under test. A hook log written inside it is the
// thing a reclaim destroys, which is the whole reason this is over HTTP.
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 8477)
const log = new URL('./hooks.log', import.meta.url)

createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    const line = JSON.stringify({ at: new Date().toISOString(), body }) + '\n'
    appendFileSync(log, line)
    process.stdout.write(line)
    response.writeHead(204).end()
  })
}).listen(port, () =>
  console.log(`spike 05 sink on :${port}, appending to ${log.pathname}`),
)
