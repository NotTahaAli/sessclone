import { ImageResponse } from 'next/og'

// The share card for every page that does not draw its own: the landing
// page's headline on the dark ground, the mark beside the name. Geist is
// `next/og`'s built-in face, so the card matches the site with no font file.
// Colours are the dark theme's tokens from `globals.css`, written out, since
// the image is rendered outside the page.

export const alt =
  'SessClone: your team runs Claude Code in three places. Count it as one.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const TEXT = '#f0eee6'
const ACCENT = '#da7453'

const FRAME = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  padding: 80,
  background: '#1f1e1d',
  color: TEXT,
} as const
const BRAND = { display: 'flex', alignItems: 'center', gap: 20 } as const
const NAME = { fontSize: 44, letterSpacing: '-0.02em' } as const
const HEADLINE = { display: 'flex', flexDirection: 'column', gap: 12 } as const
const LINE = { fontSize: 72, lineHeight: 1.08, letterSpacing: '-0.03em' }
const ACCENT_LINE = { ...LINE, color: ACCENT }
const FOOT = { fontSize: 30, color: '#a3a19a' }

export default function Image() {
  return new ImageResponse(
    <div style={FRAME}>
      <div style={BRAND}>
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 4.5H6l6.5 7.5L6 19.5" stroke={TEXT} strokeWidth={2.2} />
          <path d="M11 19.5h7" stroke={ACCENT} strokeWidth={2.4} />
        </svg>
        <div style={NAME}>SessClone</div>
      </div>
      <div style={HEADLINE}>
        <div style={LINE}>Your team runs Claude Code in three places.</div>
        <div style={ACCENT_LINE}>Count it as one.</div>
      </div>
      <div style={FOOT}>
        Usage and cost for a whole team · open source · self-host free
      </div>
    </div>,
    size,
  )
}
