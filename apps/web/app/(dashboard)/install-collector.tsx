import { CodeBlock } from './code-block'

// The install step, shown wherever somebody has to put the Collector on a
// machine: the onboarding state on Costs, and — when ticket 57 builds it —
// the Devices surface for a second machine.
//
// Ticket 66 owns the install documentation itself, including the marketplace
// manifest and the no-shell environments. What is here is the two commands and
// this deployment's own URL, which is the part ticket 45 needs to tell a new
// Owner how to install the Collector, and which the product IA requires be
// re-enterable rather than shown once.
//
// No key appears here, as a placeholder or otherwise: the plugin asks for it
// at its own prompt and Claude Code keeps it in the keychain, and ticket 28
// shows a key in full exactly once, at creation, storing only a hash — so
// there is nothing this page could substitute even if it should.

export function InstallCollector({ appUrl }: { appUrl: string }) {
  return (
    <ol className="mt-6 flex max-w-3xl flex-col gap-6">
      <li>
        <h3 className="text-heading">1. Install the plugin</h3>
        <p className="text-text-secondary mt-1 text-body">
          Two commands in Claude Code, on the machine whose usage you want
          collected.
        </p>
        <div className="mt-2 flex flex-col gap-2">
          <CodeBlock
            command="/plugin marketplace add NotTahaAli/sessclone"
            label="the marketplace command"
          />
          <CodeBlock
            command="/plugin install sessclone"
            label="the install command"
          />
        </div>
      </li>

      <li>
        <h3 className="text-heading">2. Answer the two questions it asks</h3>
        <p className="text-text-secondary mt-1 text-body">
          Enabling the plugin prompts for a deployment URL and an API key. The
          URL is this deployment:
        </p>
        <div className="mt-2">
          <CodeBlock command={appUrl} label="the deployment URL" />
        </div>
        <p className="text-text-secondary mt-2 text-body">
          The key is the one you created under Keys; it is shown once, so paste
          it at the prompt rather than looking for it again. Claude Code keeps
          it in your keychain and gives it to the Collector on every session, so
          there is nothing to export and nothing to set up again per terminal.
          To change either answer later, disable the plugin and enable it again.
        </p>
      </li>

      <li>
        <h3 className="text-heading">3. Restart Claude Code</h3>
        <p className="text-text-secondary mt-1 text-body">
          Hooks only take effect after a restart. Turns from before the restart
          are not lost: the first sweep after it backfills them, so there is no
          need to re-run the install when an existing session reports nothing.
        </p>
      </li>
    </ol>
  )
}
