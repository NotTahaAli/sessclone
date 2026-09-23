'use client'

// oxlint-disable-next-line import/no-unassigned-import -- the stylesheet is the import's whole point
import './markdown.css'

import {
  isValidElement,
  memo,
  useCallback,
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
const REHYPE = [
  [rehypeHighlight, { detect: false, plainText: ['text', 'txt'] }],
] as ComponentProps<typeof Markdown>['rehypePlugins']

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
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="md-table">
      <table {...props} />
    </div>
  ),
}

/** One message's markdown, parsed only when its text changes. */
export const MarkdownText = memo(function MarkdownText({
  text,
}: {
  text: string
}) {
  return (
    <div className="md">
      <Markdown
        remarkPlugins={REMARK}
        rehypePlugins={REHYPE}
        components={COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  )
})
