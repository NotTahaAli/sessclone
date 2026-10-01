/**
 * The Collector's install command, with both answers on it.
 *
 * One spelling, in a module of its own, because two surfaces render it: the
 * install panel with a placeholder key, and the new-key form with the real one
 * on the single render that has it. The form is a Client Component, so this
 * cannot live beside the panel — importing that module would pull it, and the
 * `CodeBlock` it renders, into the browser bundle.
 *
 * `--config` is declared by `claude plugin install --help`, and the two keys
 * are `url` and `api_key` exactly as `packages/plugin/.claude-plugin/plugin.json`
 * declares them, so a drift in either is refused by the manifest's own schema
 * rather than silently ignored.
 */
export const installCommand = (appUrl: string, apiKey?: string) =>
  [
    'claude plugin install sessclone',
    // The plugin's own default: the hosted service needs no URL answer.
    ...(appUrl.replace(/\/+$/, '') === HOSTED_URL
      ? []
      : [`--config url=${appUrl}`]),
    ...(apiKey ? [`--config api_key=${apiKey}`] : []),
  ].join(' ')

/** `default` of the `url` option in `packages/plugin/.claude-plugin/plugin.json`. */
export const HOSTED_URL = 'https://sessclone.com'

/** Step 1 on every surface that installs the Collector: the install panel and
 * the new-key form (ticket 148). */
export const MARKETPLACE_COMMAND =
  'claude plugin marketplace add NotTahaAli/sessclone'
