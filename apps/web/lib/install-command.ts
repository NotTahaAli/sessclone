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
export const installCommand = (appUrl: string, apiKey: string) =>
  `claude plugin install sessclone --config url=${appUrl} --config api_key=${apiKey}`

/**
 * The key a cloud environment's setup script installs with (Taha,
 * 2026-09-22). Not a key: the environment's API credential makes the agent
 * proxy replace the `Authorization` header on the way out, so the real key
 * never enters the container. It has a key's shape only so the Collector's
 * session-start check (`KEY_PATTERN` in `packages/plugin/src/configuration.mjs`)
 * passes it.
 */
export const CLOUD_PLACEHOLDER_KEY = `sk_${'0'.repeat(43)}`
