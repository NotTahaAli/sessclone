// Tailwind 4 is a PostCSS plugin and nothing else: no config file, no content
// globs, no JavaScript theme. The design system lives in `app/globals.css`.
const config = {
  plugins: { '@tailwindcss/postcss': {} },
}

export default config
