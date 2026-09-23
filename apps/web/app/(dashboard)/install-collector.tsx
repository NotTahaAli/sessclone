import { CodeBlock } from './code-block'
import { SetupTabs } from './setup-tabs'
import {
  CLOUD_PLACEHOLDER_KEY,
  installCommand,
} from '../../lib/install-command'

// The install step, shown wherever somebody has to put the Collector on a
// machine: the onboarding state on Costs, and the Keys page for a second
// machine.
//
// Ticket 66 owns the install documentation itself, including the marketplace
// manifest and the no-shell environments. What is here is the commands and
// this deployment's own URL, which is the part ticket 45 needs to tell a new
// Owner how to install the Collector, and which the product IA requires be
// re-enterable rather than shown once.
//
// Two routes, because they fail in different places (Taha, 2026-09-22). The
// command line carries both answers as `--config` flags, so a machine is set
// up in one paste and a fleet can be scripted; `claude plugin install --help`
// declares the flag, and the keys are `url` and `api_key` exactly as
// `packages/plugin/.claude-plugin/plugin.json` declares them, so a typo in
// either is refused by the manifest's own schema rather than silently
// ignored. Inside Claude Code the same install prompts for the two values
// instead, which is the route that keeps a key out of shell history — so both
// are here and the difference is stated rather than left for somebody to
// discover from their `~/.bash_history`.
//
// The key is a placeholder here and never a real one: ticket 28 shows a key in
// full exactly once, at creation, storing only a hash. The ready-made command
// with the key already in it belongs on that one render, and `new-key-form.tsx`
// is where it is.

const PLACEHOLDER = 'sk_your_key'

const MARKETPLACE = 'claude plugin marketplace add NotTahaAli/sessclone'

export function InstallCollector({ appUrl }: { appUrl: string }) {
  return (
    <SetupTabs>
      <OnAMachine appUrl={appUrl} />
      <InACloudEnvironment appUrl={appUrl} />
    </SetupTabs>
  )
}

function OnAMachine({ appUrl }: { appUrl: string }) {
  return (
    <ol className="mt-4 flex flex-col gap-5">
      <li>
        <h3 className="text-body font-medium">1. Add the marketplace</h3>
        <p className="text-text-muted mt-0.5 text-body">
          In a terminal on the machine whose usage you want collected.
        </p>
        <div className="mt-2">
          <CodeBlock command={MARKETPLACE} label="the marketplace command" />
        </div>
      </li>

      <li>
        <h3 className="text-body font-medium">2. Install it with your key</h3>
        <p className="text-text-muted mt-0.5 text-body">
          One command, carrying this deployment&apos;s URL and your key. Replace{' '}
          <code className="font-mono">{PLACEHOLDER}</code> with the key you
          created under Keys — it is shown once at creation, so if you no longer
          have it, create another.
        </p>
        <div className="mt-2">
          <CodeBlock
            command={installCommand(appUrl, PLACEHOLDER)}
            label="the install command"
          />
        </div>
        <p className="text-text-muted mt-2 text-body">
          A command you type is kept in your shell&apos;s history, and this one
          has your key in it. To keep it out, run{' '}
          <code className="font-mono">/plugin install sessclone</code> inside
          Claude Code instead and answer the two questions it asks. Either way
          Claude Code keeps the key in your keychain and gives it to the
          Collector on every session, so there is nothing to export and nothing
          to set up again per terminal. To change either answer later, run{' '}
          <code className="font-mono">/plugin</code> and reconfigure it.
        </p>
      </li>

      <li>
        <h3 className="text-body font-medium">3. Restart Claude Code</h3>
        <p className="text-text-muted mt-0.5 text-body">
          Hooks only take effect after a restart. Turns from before the restart
          are not lost: the first sweep after it backfills them, so there is no
          need to re-run the install when an existing session reports nothing.
        </p>
      </li>
    </ol>
  )
}

// Ticket 95, Taha's finalised route (2026-09-22). The setup script installs
// with a placeholder key, and the environment's API credential makes the agent
// proxy replace the `Authorization` header after the request leaves the
// container — so the real key is never in the script, which everyone using the
// environment can read, nor in the container. Claude's docs:
// https://code.claude.com/docs/en/cloud-environments#add-api-credentials
function InACloudEnvironment({ appUrl }: { appUrl: string }) {
  // `appUrl()` checks only that the variable is set, so a value with no
  // scheme must not take the page down: the raw value is the fallback.
  const host = URL.parse(appUrl)?.hostname ?? appUrl
  return (
    <ol className="mt-4 flex flex-col gap-5">
      <li>
        <h3 className="text-body font-medium">1. Add the setup script</h3>
        <p className="text-text-muted mt-0.5 text-body">
          Open the environment for editing in Claude Code on the web and paste
          this as its setup script. The key in it is a placeholder: leave it
          exactly as it is.
        </p>
        <div className="mt-2">
          <CodeBlock
            command={`${MARKETPLACE}\n${installCommand(appUrl, CLOUD_PLACEHOLDER_KEY)}`}
            label="the setup script"
          />
        </div>
      </li>

      <li>
        <h3 className="text-body font-medium">2. Add an API credential</h3>
        <p className="text-text-muted mt-0.5 text-body">
          In the same dialog, under API credentials, select Add credential.
        </p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
          <dt className="text-text-secondary">Name</dt>
          <dd className="font-mono">SessClone</dd>
          <dt className="text-text-secondary">Credential type</dt>
          <dd>Bearer</dd>
          <dt className="text-text-secondary">Allowed websites</dt>
          <dd className="font-mono break-all">{host}</dd>
          <dt className="text-text-secondary">Header name</dt>
          <dd className="font-mono">Authorization</dd>
          <dt className="text-text-secondary">Prefix</dt>
          <dd className="font-mono">Bearer</dd>
          <dt className="text-text-secondary">Value</dt>
          <dd>your key from Keys</dd>
        </dl>
        <p className="text-text-muted mt-2 text-body">
          The proxy puts your key on every request to {host} after it leaves the
          container, so the key is never in the script or the session. Claude
          offers API credentials on Pro and Max plans.
        </p>
      </li>

      <li>
        <h3 className="text-body font-medium">3. Start a new session</h3>
        <p className="text-text-muted mt-0.5 text-body">
          The setup script runs when a session starts, so the one already open
          reports nothing. Cloud sessions never report an end: Sessions shows
          their last Turn instead.
        </p>
      </li>
    </ol>
  )
}
