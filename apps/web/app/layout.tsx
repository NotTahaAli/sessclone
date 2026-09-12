import type { ReactNode } from 'react'

export const metadata = {
  title: 'sessclone',
  description: 'Claude Code usage and cost, for a whole team.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
