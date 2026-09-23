import type { MetadataRoute } from 'next'

import { SITE_DESCRIPTION } from '../lib/site'

// Enough for "Add to Home Screen" to use the name and the mark. Colours are
// the dark ground, which is what the mark is drawn on in the apple icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SessClone',
    short_name: 'SessClone',
    description: SITE_DESCRIPTION,
    start_url: '/costs',
    display: 'standalone',
    background_color: '#1f1e1d',
    theme_color: '#1f1e1d',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
