// A person's message as it reached Claude is often wrapped: a Claude Project
// delivers it inside a `<wake>` envelope with routing attributes, system notes
// and a list of uploads, and a cloud session opens with a `<session-context>`
// block. The chat shows what the person wrote and who wrote it; the raw text
// stays one tap away in the message's details (Taha, 2026-09-23).
//
// The envelope is harness output, not a documented format, so anything this
// does not recognise is left exactly as it was.

export type Envelope =
  | {
      kind: 'wake'
      author: string | null
      /** The person's own words, entities decoded. */
      body: string
      /** Names of files attached to the message; the files are not stored. */
      files: string[]
      /** `[image]` placeholders the transcript kept in place of images. */
      images: number
    }
  | { kind: 'context' }

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export const decode = (text: string) =>
  text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole
    const n =
      code[1] === 'x' || code[1] === 'X'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10)
    return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : whole
  })

const IMAGE = /^\[image\]\s*/

export function parseEnvelope(text: string): Envelope | null {
  let rest = text.trimStart()
  let images = 0
  while (IMAGE.test(rest)) {
    images++
    rest = rest.replace(IMAGE, '')
  }
  if (rest.startsWith('<session-context')) return { kind: 'context' }
  if (!rest.startsWith('<wake')) return null

  const message =
    /<message\b([^>]*\btrigger="true"[^>]*)>([\s\S]*?)<\/message>/.exec(rest)
  if (!message) return null
  const author = /\bauthor="([^"]*)"/.exec(message[1] ?? '')?.[1]

  const files: string[] = []
  const uploads = /<untrusted-uploads\b[\s\S]*?<\/untrusted-uploads\b/.exec(
    rest,
  )
  if (uploads) {
    for (const line of uploads[0].split('\n')) {
      const name = /^\s+(.+?) \(file_[A-Za-z0-9]+\)/.exec(line)?.[1]
      if (name) files.push(name)
    }
  }

  return {
    kind: 'wake',
    author: author ? decode(author) : null,
    body: decode(message[2] ?? '').trim(),
    files,
    images,
  }
}
