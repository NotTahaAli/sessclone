import type { ReactNode } from 'react'

import { FRAME } from './constants'

// The frame the Privacy and Terms pages share: one readable column, the
// headings and lists styled here so the pages stay plain JSX prose.
//
// Both pages were drafted by Claude for the launch (2026-09-23) and have NOT
// been reviewed by a lawyer; that review is Taha's to arrange before paid
// plans open (see NOTICE.md for the same caveat on the licence term).
export function Legal({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <div className={FRAME}>
      <article
        className={`text-text-secondary [&_a]:text-text [&_h2]:text-text [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:underline [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-[17px] [&_h2]:font-semibold [&_p]:mt-3 max-w-[44rem] pt-6 pb-16 text-body lg:pt-12`}
      >
        <h1 className="text-text text-[28px] font-semibold tracking-[-0.02em] lg:text-[36px]">
          {title}
        </h1>
        <p className="text-text-muted text-caption">Last updated {updated}</p>
        {children}
      </article>
    </div>
  )
}
