'use client'

// oxlint-disable-next-line import/no-unassigned-import -- the stylesheet is the import's whole point
import './markdown.css'

import {
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

// Claude's replies are markdown; the chat renders them the way Claude's own
// apps do (Taha, 2026-09-23). Code blocks carry their language, highlighting
// in the dashboard's own colours (markdown.css), and a copy button.
//
// Raw HTML in a message is shown as text, never rendered: a transcript quotes
// markup all the time, and none of it is ours to run. react-markdown drops raw
// HTML by default, which would silently delete it, so `htmlAsText` turns it
// back into a text node first.

type Node = { type: string; value?: string; children?: Node[] }

const walk = (node: Node) => {
  if (node.type === 'html') node.type = 'text'
  node.children?.forEach(walk)
}

const htmlAsText = () => walk

const REMARK = [remarkGfm, htmlAsText]
// Only fenced blocks that name a language are highlighted; guessing is slow
// and often wrong on a short snippet.
//
// Built once: react-markdown runs every attacher on every render, and
// rehype-highlight's attacher registers all its grammars each time it runs
// (7.0.2, `createLowlight(common)`), which was ~0.4 ms a message and about
// 5.5 s of a 13,749-message "Jump to start". Its transformer does not use
// `this`, so one instance serves every message.
const highlight = rehypeHighlight({ detect: false, plainText: ['text', 'txt'] })
const REHYPE = [() => highlight] as ComponentProps<
  typeof Markdown
>['rehypePlugins']

const LANGUAGE = /language-([\w+#-]+)/

function CodeBox({
  children,
  node: _node,
  ...rest
}: ComponentProps<'pre'> & { node?: unknown }) {
  const pre = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const child = Array.isArray(children) ? children[0] : children
  const className = isValidElement<{ className?: string }>(child)
    ? (child.props.className ?? '')
    : ''
  const language = LANGUAGE.exec(className)?.[1] ?? 'text'
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pre.current?.textContent ?? '')
      // Stays until the next copy: no timer to outlive the row (AGENTS.md).
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }, [])
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{language}</span>
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
          <span className="sr-only"> {language} code</span>
        </button>
      </div>
      <pre ref={pre} {...rest}>
        {children}
      </pre>
    </div>
  )
}

const COMPONENTS: Components = {
  pre: CodeBox,
  // External links open in a new tab; in-page ones (footnotes) do not.
  a: ({ node: _node, ...props }) =>
    props.href?.startsWith('#') ? (
      <a {...props} />
    ) : (
      <a {...props} target="_blank" rel="noopener noreferrer" />
    ),
  // Never fetched: an image URL in a transcript could carry a secret out to
  // whoever serves it, from every reader's browser. A link, opened on purpose.
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || src}
      </a>
    ) : (
      <span>{alt}</span>
    ),
  table: ({ node: _node, ...props }) => (
    <div className="md-table">
      <table {...props} />
    </div>
  ),
}

// Parsing is most of what a message row costs, and "Jump to start" mounts
// every row of a long transcript at once: 13,749 of them spent ~5 s here
// (2026-09-25). So a message is plain text until it first comes within a
// screen of view, then markdown for good. One observer for every message;
// `waiting` holds only mounted, unseen ones, so it never outgrows the page.
const waiting = new Map<Element, () => void>()
let observer: IntersectionObserver | null = null

const unwatch = (element: Element) => {
  waiting.delete(element)
  observer?.unobserve(element)
}

const watch = (element: Element, show: () => void) => {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        waiting.get(entry.target)?.()
        unwatch(entry.target)
      }
    },
    // `scrollMargin` widens the column's own scroll box, which clips a row
    // before the viewport does; where it is unsupported a row turns to
    // markdown as it scrolls into view rather than a screen before.
    { rootMargin: '100% 0px', scrollMargin: '100% 0px' },
  )
  waiting.set(element, show)
  observer.observe(element)
}

/** One message's markdown, parsed only when its text changes. */
export const MarkdownText = memo(function MarkdownText({
  text,
}: {
  text: string
}) {
  const box = useRef<HTMLDivElement>(null)
  // No observer (the server, tests): markdown straight away. Rows are only
  // ever rendered in the browser, after their bytes are fetched.
  const [seen, setSeen] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  useEffect(() => {
    const element = box.current
    if (seen || !element) return undefined
    watch(element, () => setSeen(true))
    return () => unwatch(element)
  }, [seen])
  return (
    <div ref={box} className="md">
      {seen ? (
        <Markdown
          remarkPlugins={REMARK}
          rehypePlugins={REHYPE}
          components={COMPONENTS}
        >
          {text}
        </Markdown>
      ) : (
        <p className="whitespace-pre-wrap">{text}</p>
      )}
    </div>
  )
})
