# Product information architecture

The map of every surface in the product and who may reach it. Ticket 17 asks
for navigation to be designed once rather than accreted, so this file fixes the
shape: four top-level destinations, two settings destinations, one onboarding
flow, and a named empty state for everything that can be empty on day one.

It decides placement and authority. It does not decide layout — ticket 18 owns
the wireframes and the chart specs, and it is blocked by this file — nor
component shape, which is ticket 20's.

Vocabulary is `CONTEXT.md`'s throughout. Org, Member, Role, Scope, Device,
Project, Session, Turn, Collector, Usage, Rate, Cost, Log Artifact, Retention,
Tier, Seat and Platform Admin mean there what they mean here, and nothing in
this file introduces a term that file does not carry.

Where a ticket states which Roles may reach a surface, this file cites it.
Where a ticket does not, the inference is marked **inferred** in the table and
explained under the table it appears in. Nothing here invents a surface no
ticket asks for.

## Navigation

### Four top-level destinations

The signed-in navigation is Costs, Keys, Devices, Settings. Everything else
hangs off one of those four. The dashboard shell that carries them is ticket
45, which asks for navigation reflecting what the signed-in Role may reach.

| Destination | What it holds                                                           | Ticket             |
| ----------- | ----------------------------------------------------------------------- | ------------------ |
| Costs       | The four views of spend, and the date range that applies to all of them | 52, 53, 54, 55, 56 |
| Keys        | The signed-in person's own API keys                                     | 28                 |
| Devices     | The signed-in person's own machines and their nicknames                 | 57                 |
| Settings    | Two destinations — Org settings and Your settings                       | see below          |

All four are reachable by every Role. What a Role sees inside Costs differs;
what it may reach does not. That is deliberate: reads pass through the policies
(ADR 0001, proven by ticket 44), so a Member opening Costs sees their own Turns
and a Manager sees their Scope, without either of them meeting a refusal.

Keys and Devices are top-level rather than buried in settings because both are
part of installing the Collector, which is the one thing every person in the
product has to do before the product does anything at all. A person adding a
second machine should not have to reason about whether a key is a setting.

### Costs is one area with four views

Tickets 52, 54, 55 and 56 are four questions about the same data: what the Org
spent over time, per Member, per Project, per Device. They are one destination
with a view switch, not four items in the navigation.

The reason is the date range. Ticket 53 requires the range to be built once,
reflected in the URL, interpreted in the Org's timezone, and inherited by the
later breakdowns rather than reimplemented. A range that survives the switch
from over-time to per-Member is the whole point of building it once; four
separate destinations would make the range a property of each one, and the
first thing anyone would notice is that changing the view silently changed the
period they were reading.

So the range lives in the URL beside the view, and only the view changes when
the switch is used:

```
/costs?view=time&from=2026-09-01&to=2026-09-20
/costs?view=members&from=2026-09-01&to=2026-09-20
/costs?view=projects&from=2026-09-01&to=2026-09-20
/costs?view=devices&from=2026-09-01&to=2026-09-20
```

Both halves of the URL are load-bearing. Ticket 53 asks for the range to be in
the URL so a view can be shared or reloaded; putting the view there too means
the link someone pastes into a thread is the view they were looking at, not the
default one with their dates on it.

Costs is also where the honest caveats live. Ticket 52 requires token counts
beside every Cost figure and unpriced Turns counted and labelled rather than
rendered as free; ticket 43 supplies the unpriced count alongside any total.
`CONTEXT.md` is explicit that Cost is an estimate and that unknown is not zero,
and the four views are where a reader would otherwise forget it.

### Where everything else hangs

| Thing                                 | Where it lives                                | Ticket     |
| ------------------------------------- | --------------------------------------------- | ---------- |
| Date range control                    | Inside Costs, applying to all four views      | 53         |
| A Member's Log Artifacts              | Your settings                                 | 60, 72, 73 |
| Another Member's Log Artifacts        | A row in Costs → per Member                   | 60         |
| Manager Scope, as assigned            | Org settings → Members                        | 46         |
| Manager Scope, as seen by the Manager | Your settings                                 | 46         |
| Tier, seats and price                 | Org settings → Tier                           | 47         |
| Retention                             | Org settings, beside timezone                 | 61         |
| Manual activation                     | Platform administration → the Org's Tier page | 48, 65     |
| Install commands                      | Onboarding, and re-enterable from Keys        | 66         |

Two of those are placements this file decides rather than inherits.

**Another Member's Log Artifacts.** Ticket 60 states the authority precisely —
a Member downloads their own, an Owner and Admin download any Member's, a
Manager only those in their Scope — and names no surface. The entitled reader
is already looking at the person when they want the transcript, so the download
is reached from that person's row in Costs → per Member rather than from a
separate area. **Inferred placement**; the Roles are ticket 60's.

**Manual activation.** Ticket 48 gives a Platform Admin activation and
deactivation with a recorded note, and ticket 65 gives the same operator Tiers
and an Org's subscription history in one place. Two surfaces for one act would
mean the history sat away from the switch that writes it, so activation is a
control on the Org's Tier page in platform administration and writes its
subscription event from there. Ticket 48 keeps its own acceptance criteria;
it does not keep its own page.

## Settings is two destinations

Settings is Org settings and Your settings. They are separate destinations with
separate navigation entries, not two sections of one page.

| Org settings — Owner or Admin              | Your settings — everyone                                        |
| ------------------------------------------ | --------------------------------------------------------------- |
| Timezone (51)                              | Your accent seed and your light, dark or system preference (77) |
| Retention (61)                             | Your archival master switch and your Project exclusions (72)    |
| Default accent seed and the seed lock (77) | Your Devices and their nicknames (57)                           |
| Org logo (77)                              | Your Log Artifacts, and their deletion (60, 73)                 |
| Members, Roles, removal (49, 50)           | Your Scope, if you are a Manager (46)                           |
| Invitations (49)                           |                                                                 |
| Tier, seats and price (47)                 |                                                                 |

### Why they are separate

A page that is mostly refused reads as broken. If the two were one page, a
Member opening Settings would meet a list dominated by controls they cannot
operate — timezone, retention, the logo, everyone else's Role — with their own
four controls somewhere inside it. Disabling those controls does not fix it:
the page still says the product is mostly not for them, on the one surface
where the product is entirely about them, and it invites the reasonable
conclusion that something is wrong with their account rather than that they are
a Member.

Separating them also puts each control beside the thing it governs. Retention
is an Org-wide ceiling on storage; a Member's archival switch decides whether
anything is stored for that Member at all. They read as the same control when
they sit in one list, and ADR 0005 keeps them apart on purpose. Ticket 72 is
blunt about ownership: nothing else in the product may write a Member's
archival settings, and no Role can write another Member's. A destination only
that Member can reach is the shape that matches.

Your settings carries one read-only item: a Manager's own Scope. Ticket 46 asks
for a Manager to see their Scope so they know what they can and cannot see, and
that is a fact about the signed-in person rather than about the Org. The
assignment control is the Org's, and lives on Org settings → Members.
**Inferred placement**; ticket 46 requires the Manager can see their Scope and
does not say where.

### The one page inside Org settings that an Admin does not reach

Org settings is reachable by an Owner or an Admin. The Tier page is not: ticket
47 calls it the Owner-facing tier page and shows the Tier, seat allowance and
price to the Owner, and `CONTEXT.md` gives an Admin the whole Org's data and
settings but no billing. So the Tier entry is absent from an Admin's Org
settings navigation rather than present and refused, which is the same rule as
the one that split settings in two, applied one level down.

### Retention sits beside timezone

Ticket 61 sets Retention on the Org, defaulted, capped by the Tier ceiling.
Ticket 51 sets the timezone on the Org, defaulted sensibly. Both are
Org-wide values that change how everyone's data is read or how long it is kept,
and both are set once and rarely revisited. They are two fields in one section
of Org settings.

The Tier ceiling is shown where the Owner sets the value, not only on the Tier
page — ticket 47 requires the retention ceiling shown there because it bounds a
setting the Owner controls, and ticket 61 requires the setting capped by it. A
ceiling stated only on the page that does not hold the control is a ceiling
somebody discovers by being refused.

## Onboarding

Onboarding is the centrepiece of this document because it is where the product
either works or silently does not. Everything after it is charts.

### It is driven by observed state, never by a wizard flag

There is no `onboarding_step` column and no "completed setup" boolean. The flow
reads three facts the product already has:

1. Does this person have an API key? (ticket 28)
2. Has any Turn arrived for this Org, or for this person? (tickets 31, 33)
3. Does the Org have more than one Member? (tickets 21, 49)

Everything the flow shows is a function of those three. The consequences are
the reason for the rule:

- **It is resumable.** Closing the tab loses nothing, because nothing was
  stored about where they were. Reopening recomputes it.
- **It survives signing out halfway.** Signing back in re-reads the same three
  facts and lands on the same step. Ticket 27 requires signing out and back in
  to return to the same Org; this makes it return to the same place in the Org.
- **It cannot lie.** A flag says setup finished; observed state says a Turn
  arrived. Those differ exactly when something went wrong, which is the moment
  the person needs the truth. A flag set at the end of the install step would
  mark as complete an install that never reported once.
- **It re-enters correctly.** A Member who adds a second machine is in the same
  state as a Member who has never installed anything, for that machine — see
  re-entry below.

The flow is not a modal over the dashboard and not a separate wizard route. It
is what the dashboard shows while those facts are still false, which is what
ticket 45 means by the states a brand-new Org sees before any Turn arrives.

### A new Owner's path

Ticket 27 creates the Org on first sign-in and makes the signer its Owner.
From there:

**1. Sign in.** GitHub or a magic link (ticket 27). No password is created or
stored. The magic-link path exists for people whose employer blocks OAuth apps,
so it is offered beside GitHub rather than behind a "more options" disclosure.

- _Waiting:_ after a magic link is requested, the page says the link has been
  sent to that address and that it can be requested again.
- _Failing:_ an expired or already-used link returns to sign-in with a line
  saying the link has expired and the address prefilled.

**2. Confirm the Org name and its timezone.** Ticket 51 requires the timezone
defaulted sensibly on Org creation; the default is read from the browser, and
the step shows it filled in rather than empty. This is the only Org-level
question asked during onboarding, and it is asked because every chart that
buckets by day depends on it and re-bucketing later changes what every chart
already shown meant.

- _Waiting:_ nothing to wait for; both values are already filled.
- _Failing:_ if the browser reports no timezone, the field falls back to UTC
  and says so, so an unnoticed default is a stated one.

**3. Create the first API key.** Ticket 28 shows the key in full exactly once
and never again; only a hash and a short prefix are stored. The step says so
before the key appears, not after, and it labels the key with the machine it is
for, because ticket 28's labels are per machine and a key labelled on day one
is a key that can be revoked on day ninety without guessing.

- _Waiting:_ the create control is disabled while the key is being issued.
- _Failing:_ if creation fails, no key is shown and none was stored; the step
  says the key was not created and offers the control again. It never shows a
  partial value.
- _Leaving this step without copying the key:_ the flow does not block it. The
  next step offers to create another key, because a key that cannot be shown
  again is cheaper to replace than to recover, and ticket 28 allows several
  active keys at once.

**4. Install the Collector.** Ticket 66 requires install in two commands from a
marketplace manifest in this repository. Both commands are shown with the key
already substituted into them, and both are copyable — the CodeBlock with its
copy control exists for this, and the design system names ticket 45 as its
caller. The two variables behind the substitution are `SESSCLONE_API_KEY` and
`SESSCLONE_URL`, and `docs/configuration.md` is the contract for both;
`SESSCLONE_URL` is filled from `NEXT_PUBLIC_APP_URL`, so a self-hoster's team is
told to report to the self-hoster's deployment rather than to ours.

An environment with no shell the Member can reach — Claude Code Cloud, Claude
Projects — gets its own install path on this step rather than a footnote:
the plugin from the environment's init script, the key from the environment's
own settings. Ticket 66 requires that path written down, and finding 74 is
where it came from.

- _Waiting:_ nothing; this step is instructions.
- _Failing:_ there is no failure the product can observe here. That is the
  point of step 5.

**5. Restart Claude Code.** Stated as its own step, not as a line inside step 4. Ticket 66 requires the restart requirement stated plainly and requires the
documentation to say that Turns from before the restart are backfilled by the
first sweep (ticket 39). Both sentences appear here, because the second one is
what stops a person re-running the install when their existing session reports
nothing.

**6. Wait for the first Turn.** A surface of its own, and the most important
screen in the product. It says what should happen next: run a Claude Code turn,
and it should appear here within a minute or so of that turn ending. It polls;
it does not ask the person to refresh.

- _Waiting:_ "Waiting for the first Turn from this Device." Below it, what to
  expect: the Collector reports when a turn ends, so nothing arrives until a
  turn ends.
- _After a few minutes with nothing:_ the surface changes rather than sitting
  still. It names the four things that are actually wrong when a Collector does
  not report, in the order they are worth checking:
  1. Claude Code was not restarted after the install. Hooks only take effect
     after a restart (ticket 66).
  2. The key is missing or malformed in the environment the Collector runs in.
     Ticket 32 makes this fail loudly at setup rather than silently at report
     time, so the Collector itself should already have said so.
  3. `SESSCLONE_URL` points somewhere other than this deployment. The value
     this deployment expects is shown, so it can be compared rather than
     recalled.
  4. Nothing has been reported because no turn has ended yet.
     The step also offers the two actions that resolve the remaining cases:
     show the install commands again, and issue a fresh key.
- _Failing at the key:_ if a report arrives with an unknown or revoked key it
  writes nothing (ticket 34), so from this surface it is indistinguishable from
  silence. The list above names it; nothing else can.
- _Partial success:_ a key whose last-used time is set (tickets 28, 34) but for
  which no Turn has landed is a different state, and the surface says so: the
  Collector has reached this deployment, and the problem is downstream of the
  key rather than in it.

**7. The dashboard, with their own first Turn on it.** The moment a Turn
arrives the waiting surface is replaced by Costs. It is not a congratulations
screen; it is the product, with one Turn on it, one Device, and one Project.

**A Collector that never reports is the most likely failure in the whole
product.** It has the most moving parts — a plugin install, a hook registration,
a restart, an environment variable, a network path — and every one of them
fails silently from the dashboard's side, because the dashboard's evidence for
all five is the same: no rows. Step 6 is therefore the only step in the flow
that is allowed to grow in size over time, and the only one that names causes
rather than describing state. Ticket 39 requires the residual gap documented
where a user will see it rather than only in the spec; this surface is where a
user sees it.

### An invited Member's path

Shorter, because the Org already exists and somebody else configured it.

**1. Accept the invitation.** Ticket 49 sends the invitation by email and
accepts it from a new or existing user, landing the person in the Org with the
Role the Owner chose. The Org logo appears on the invite email and on sign-in
(ticket 77), so the person arriving recognises whose Org they are joining.

- _Failing:_ an expired invitation, a replayed one, and one that would exceed
  the Tier's seat limit are three different refusals with three different
  sentences. Ticket 49 requires invitations to expire, a used invitation not to
  be replayable, and a seat-limit refusal to tell the Owner why — the person
  accepting is told plainly that the Org has no seat free and that the Owner
  has been told, rather than being shown a generic failure they cannot act on.

**2. Create their own key.** Same surface as the Owner's step 3, same
once-only rule (ticket 28). Keys are per person and per machine; an invited
Member never uses somebody else's.

**3. Install and restart.** Steps 4 and 5 above, unchanged.

**4. Wait.** Step 6 above, scoped to their own first Turn.

**5. Done.** Costs, showing what their Role may see. A Member sees their own
usage; a Manager sees their Scope, which on day one may be empty.

They never see steps 2 — the Org name and timezone are already set and are not
theirs to change — and never see Org settings at all unless their Role is Owner
or Admin. An invited Admin's path is the Member's path; the Org-level questions
were answered when the Org was created and are not re-asked.

### Where the flow is re-entered from later

The flow is state, so re-entry is not a special case — it is the same
computation with a narrower subject.

| Who                                        | What they need                                  | Where they get it                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Member adding a second Device            | A key for the new machine, and the two commands | Keys → create a key, which shows the install commands with the new key substituted, exactly as onboarding step 4 does                               |
| Anyone who lost a key                      | A replacement, not a recovery                   | Keys → create a key. The old key is revoked from the same list (ticket 28), which affects only that key                                             |
| An Owner who wants the commands again      | The commands, without a new key                 | Keys → the install instructions, shown with a placeholder where the key goes, since the key cannot be shown twice                                   |
| A Member whose new Device has not reported | The waiting surface, for that Device            | Devices, which lists their Devices and when each last reported (ticket 57). A Device that has never reported is the day-one state, one machine down |
| An Org whose subscription is inactive      | To know that, rather than to debug it           | The whole-surface inactive state (ticket 48), which replaces the dashboard rather than letting it render empty                                      |

Installing on a second machine is the Devices list plus the Keys list, not a
repeat of the whole flow: the Org exists, the timezone is set, and a Turn has
already arrived. That is precisely what observed state gets right and a wizard
flag gets wrong.

## Signed-in surfaces

Roles are `CONTEXT.md`'s: Owner, Admin, Manager, Member. "All" means all four
reach the surface, with the rows each Role may read decided by the policies
(ADR 0001) and proven by ticket 44, not by the navigation.

| Surface                                          | Path                                | Who reaches it                                                                           | Ticket     | Note                                                                                   |
| ------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| Dashboard shell and Org context                  | all signed-in paths                 | All                                                                                      | 45         | Navigation reflects what the Role may reach                                            |
| Costs — over time                                | `/costs?view=time`                  | All                                                                                      | 52         | Read through the policies, so each Role's totals are already correct                   |
| Costs — per Member                               | `/costs?view=members`               | All; Owner and Admin see everyone, Manager sees their Scope, Member sees only themselves | 54         | Roles stated by the ticket                                                             |
| Costs — per Project                              | `/costs?view=projects`              | All, scoped as above                                                                     | 55         | Scoped by Role in the same way as every other view                                     |
| Costs — per Device                               | `/costs?view=devices`               | All, scoped as above                                                                     | 56         | Cloud containers collapse to one Device per Member                                     |
| Another Member's Log Artifacts                   | row action in `/costs?view=members` | Owner, Admin; Manager within Scope                                                       | 60         | **Inferred placement**, stated Roles                                                   |
| Keys                                             | `/keys`                             | All, own keys only                                                                       | 28         | **Inferred Roles** — see below                                                         |
| Install instructions                             | `/keys`                             | All                                                                                      | 66         | Re-entry point for the install commands                                                |
| Devices                                          | `/devices`                          | All, own Devices only                                                                    | 57         | A Member cannot rename another Member's Device                                         |
| Your settings — appearance                       | `/settings/you`                     | All                                                                                      | 77         | Seed editable unless the Org has locked it; mode always personal                       |
| Your settings — archival                         | `/settings/you`                     | All                                                                                      | 72         | Master switch off by default; Project exclusions listed from the Member's own Sessions |
| Your settings — Log Artifacts                    | `/settings/you`                     | All, own artifacts only                                                                  | 60, 73     | Deletion is separate from the switch, per ADR 0005                                     |
| Your settings — your Scope                       | `/settings/you`                     | Manager                                                                                  | 46         | **Inferred placement**; read-only                                                      |
| Org settings — timezone                          | `/settings/org`                     | Owner, Admin                                                                             | 51         | Roles stated by the ticket                                                             |
| Org settings — retention                         | `/settings/org`                     | Owner, Admin                                                                             | 61         | Settled 2026-09-20 — see below                                                         |
| Org settings — appearance defaults and seed lock | `/settings/org`                     | Owner, Admin                                                                             | 77         | Roles stated by the ticket                                                             |
| Org settings — Org logo                          | `/settings/org`                     | Owner, Admin                                                                             | 77         | A Member cannot remove it                                                              |
| Org settings — Members and Roles                 | `/settings/org/members`             | Owner, Admin                                                                             | 49, 50     | Settled 2026-09-20 — see below                                                         |
| Org settings — Manager Scope assignment          | `/settings/org/members`             | Owner, Admin                                                                             | 46         | Roles stated by the ticket                                                             |
| Org settings — invitations                       | `/settings/org/members`             | Owner, Admin                                                                             | 49         | Settled 2026-09-20 — see below                                                         |
| Org settings — Tier                              | `/settings/org/tier`                | Owner                                                                                    | 47         | Admin has no billing, per `CONTEXT.md`; the entry is absent for an Admin               |
| Onboarding — Org name and timezone               | `/costs`, as state                  | Owner, Admin                                                                             | 27, 51     | Shown while the Org has no key                                                         |
| Onboarding — first key                           | `/costs`, as state                  | All                                                                                      | 28         | Shown while the person has no key                                                      |
| Onboarding — install and restart                 | `/costs`, as state                  | All                                                                                      | 66         | Shown while the person has a key and no Turn                                           |
| Onboarding — waiting for the first Turn          | `/costs`, as state                  | All                                                                                      | 33, 39, 66 | The failure-naming surface                                                             |
| Inactive Org                                     | replaces every signed-in path       | All                                                                                      | 48         | An inactive Org is told it is inactive rather than shown a broken dashboard            |

### Roles settled, and roles this file inferred

Two of the conflicts below were put to the product owner on 2026-09-20 and
settled: retention is Owner or Admin, and Members, Roles and invitations are
Owner or Admin. Tickets 49, 50 and 61 are narrower than that and should be read
as settled here rather than as disagreeing.

**Keys (ticket 28).** The ticket says "a Member creates a key" and names no
Role. `CONTEXT.md` makes Member the least authoritative Role, and every Role
runs Claude Code and therefore needs a key, so Keys is reachable by all four
and shows only the signed-in person's own keys. No Role sees another person's
key list, including an Owner: a key is a credential, and ticket 28 stores only
a hash and a prefix, so there is nothing an Owner could usefully be shown.
Revocation of somebody else's key is not a surface in this file because no
ticket asks for one.

**Retention (ticket 61).** The ticket says retention is set by an Owner.
`CONTEXT.md` gives an Admin the whole Org's data and settings, with billing as
the only exclusion, and retention is not billing. Settled as Owner or Admin,
matching the timezone control it sits beside. Ticket 61's wording alone would
have put it on the Tier page with the Owner-only controls; it does not go
there.

**Members, Roles and invitations (tickets 49, 50).** Ticket 49 says an Owner
invites; ticket 50 says an Owner changes a Role and removes a Member. Neither
names an Admin. Ticket 46, written against the same area, says an Owner _or
Admin_ assigns and removes Members from a Manager's Scope, and `CONTEXT.md`
gives an Admin the whole Org's settings. Settled as Owner or Admin for all three.
Read narrowly, 49 and 50 would put an Admin on a Members page where the Scope
control works and the Role control does not, which is the split page this
document's settings decision exists to avoid.

## Signed-out surfaces

| Surface               | Path                         | Ticket         | Note                                                                                          |
| --------------------- | ---------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| Landing               | `/`                          | 26             | The problem and the collection-everywhere claim; the install command is in the hero           |
| Pricing               | `/pricing`                   | 26             | Tiers, per-seat pricing, and what each Tier includes                                          |
| Self-hosting          | link out from `/pricing`     | 26, 67         | Presented as the free path, linking to the repository                                         |
| Install documentation | repository, linked from both | 66, 67, 68, 69 | Includes the restart requirement, the backfill sentence, and the no-shell environments        |
| Sign-in               | `/sign-in`                   | 27             | GitHub and magic link side by side. Carries the Org logo when reached from an invitation (77) |
| Magic link sent       | `/sign-in`, as state         | 27             | Confirms the address and offers to send again                                                 |
| Invitation acceptance | `/invite/<token>`            | 49             | Accepted by a new or existing user; expiry, replay and seat-limit refusals are distinct       |

A signed-out visitor gets the theme applied on first paint with no flash
(ticket 77), which is why appearance is a property of these pages and not only
of the dashboard.

## Platform administration

Platform Admin is not a Role inside any Org. `CONTEXT.md` is explicit: it is the
operator of a deployment, governing the deployment rather than one Org. So the
admin area is gated on the platform flag carried by the account (ticket 21's
schema, ticket 62's gate), never on an Org Role. An Org Owner is refused —
ticket 62 states that as an acceptance criterion, and requires the gate enforced
in policy as well as in routing, with the refusal covered by the policy suite
(ticket 44).

The practical rule that follows: nothing in the signed-in navigation ever leads
here for someone without the flag, and no Org Role, however senior, ever grants
it. The admin area has its own navigation (ticket 62) and does not reuse the
Org navigation, because the subjects are different — the deployment's Rates and
Tiers, and every Org on it, rather than one Org's spend.

| Surface                        | Path                      | Who reaches it     | Ticket | Note                                                                                                            |
| ------------------------------ | ------------------------- | ------------------ | ------ | --------------------------------------------------------------------------------------------------------------- |
| Admin shell and navigation     | `/admin`                  | Platform flag only | 62     | An Org Owner is refused; gate is in policy and in routing                                                       |
| Rates                          | `/admin/rates`            | Platform flag only | 41, 63 | Effective-dated; a price change is a new row, never an overwrite                                                |
| Unknown models                 | `/admin/rates`            | Platform flag only | 43, 63 | Distinct unknown model identifiers, with how many Turns each affects                                            |
| Fetch latest pricing           | `/admin/rates`            | Platform flag only | 97     | Proposes changes from the published page; nothing is written until the operator approves a model                |
| Org rate overrides             | `/admin/orgs/<org>/rates` | Platform flag only | 64     | Invisible to every other Org; resolution prefers the override                                                   |
| Tiers                          | `/admin/tiers`            | Platform flag only | 65     | Seats, price and capabilities; changes take effect without a deployment                                         |
| An Org's Tier and subscription | `/admin/orgs/<org>`       | Platform flag only | 48, 65 | Activation and deactivation with a recorded note, writing an event each time; subscription history in one place |

**Inferred paths.** Tickets 62 to 65 name the pages and their gate but no
routes; the paths above are this file's spelling, chosen so an Org-specific
admin page is legible as one.

## Empty states

Every surface that can be empty on day one, the sentence it shows, and the
action it offers. Ticket 45 requires the empty state that tells a new Owner how
to install the Collector; the design system's EmptyState component (ticket 45)
carries day-one variants for the dashboard, Members, Projects, Devices, keys and
Log Artifacts, and this is the list those variants are cut from. The deactivated
Org uses the whole-surface variant and the neutral tokens, because deactivation
is an ordinary state rather than a failure.

| Surface                                                         | Sentence                                                                                                          | Action                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Costs — over time, no Turns                                     | "Nothing has been collected yet. The first Turn appears here within about a minute of a Claude Code turn ending." | Install the Collector — goes to the onboarding install step (66)    |
| Costs — over time, Turns outside the range                      | "No Turns in this period."                                                                                        | Widen the range to the last 30 days (53)                            |
| Costs — per Member, one Member                                  | "You are the only Member of this Org."                                                                            | Invite someone (49) — Owner and Admin only; a Member sees no action |
| Costs — per Member, Manager with an empty Scope                 | "Your Scope is empty, so there is nothing here to show."                                                          | Ask an Owner or Admin to add Members to your Scope (46)             |
| Costs — per Project, no Turns                                   | "No Projects yet. A Project appears once a Session has run against it."                                           | None — this resolves itself when Turns arrive (55)                  |
| Costs — per Device, no Turns                                    | "No Devices have reported yet."                                                                                   | Install the Collector (66)                                          |
| Keys, no key                                                    | "You have no API key yet. The Collector needs one to report."                                                     | Create a key (28)                                                   |
| Devices, none reported                                          | "No Device has reported for you yet. A Device appears the first time the Collector reports from it."              | Show the install commands (57, 66)                                  |
| Your settings — Project exclusions, no Projects                 | "You have no Projects yet, so there is nothing to exclude. New Projects are archived unless you exclude them."    | None (72)                                                           |
| Your settings — Log Artifacts, archival off                     | "Archival is off, so no transcripts are stored. Turning it on stores new Sessions and does not reach back."       | Turn archival on (72)                                               |
| Your settings — Log Artifacts, archival on and nothing uploaded | "No transcripts stored yet. A Session's transcript is uploaded after the Session ends."                           | None (59)                                                           |
| Your settings — Scope, Manager with an empty Scope              | "Your Scope is empty. You can see nobody's usage but your own."                                                   | None (46)                                                           |
| Org settings — Members, only the Owner                          | "You are the only Member of this Org."                                                                            | Invite someone (49)                                                 |
| Org settings — invitations, none outstanding                    | "No invitations outstanding."                                                                                     | Invite someone (49)                                                 |
| Org settings — Tier, no subscription active                     | "This Org has no active subscription."                                                                            | None from here; activation is the Platform Admin's (47, 48)         |
| Whole product — Org inactive                                    | "This Org's subscription is not active. Collection continues; the dashboard returns when it is reactivated."      | None (48)                                                           |
| Platform admin — unknown models, none                           | "Every model seen in a Turn has a Rate."                                                                          | None (43, 63)                                                       |
| Platform admin — Tiers, none defined                            | "No Tiers defined yet."                                                                                           | Create a Tier (65)                                                  |
| Platform admin — Org rate overrides, none                       | "This Org uses the platform Rate table."                                                                          | Add an override (64)                                                |

Two surfaces are deliberately absent from this list. Rates is seeded at
migration time (ticket 41), so an empty Rate table is a deployment fault rather
than a day-one state and shows the error state, not an empty one. Costs — over
time on a Turn whose model has no Rate is not empty either: ticket 52 requires
unpriced Turns counted and labelled, never rendered as free, so that is a
populated view with an annotation.

## What has no home yet

Named here so it is visible rather than lost.

**The failure record from ticket 40 has no surface.** Ticket 40 records the
failure type and message against a Session when a session dies on a rate limit
or an overload, and calls it the question a subscription user actually has. The
route accepts it, the table ships with its policies, and the policy suite covers
them — and then nothing shows it to a person. No ticket from 45 to 77 reads that
table. A record with no reader is a record nobody will notice has stopped being
written.

It is not placed here because placing it would be inventing a surface, which
this file does not do. Where it most plausibly belongs, when a ticket asks for
it: beside the Costs views, since "how often did we get rate-limited" is a
question about the same period the range control already governs, and a Member
needs it about themselves while an Owner needs it about the Org — the same
scoping every Costs view already has.

Two smaller gaps, for the same reason:

- **Ticket 39's residual gap** is required to be documented where a user will
  see it rather than only in the spec. The onboarding waiting surface is the
  only surface in this file that speaks about collection reliability, so it is
  where that sentence lands unless ticket 39 finds a better home. This file
  claims the placement; the wording is ticket 39's.
- **Why a Device is keyed the way it is.** Ticket 76's closing note records
  that the deleted implementation carried a `source` field saying which rule
  produced a Device key, so a container-keyed Device would be legible as one on
  a dashboard, and that it belongs in ticket 56 if a per-Device breakdown ever
  needs to explain itself. Nothing consumes it today. Costs — per Device is
  where it would show.
