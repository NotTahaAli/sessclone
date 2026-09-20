# 17: Product information architecture

**What to build:** A map of every surface in the product and who can reach it, so navigation is designed once rather than accreted.

**Blocked by:** 16.

**Status:** done

- [x] Every signed-in surface listed, with the Roles that may see it
- [x] Navigation structure defined, including where platform administration sits
- [x] Onboarding path from first sign-in to first collected Turn
- [x] Empty states named for every surface that can be empty on day one

**Answer:** `docs/design/product-ia.md` maps every surface, who reaches it, and
how a person gets from a first sign-in to a Turn on a chart.

Navigation is four destinations. Costs holds the four views of the same data —
over time, per Member, per Project, per Device — switched inside one area with
the date range persisting across the switch and living in the URL, because they
are one question asked four ways rather than four places to go. Keys and Devices
are their own. Settings is deliberately two destinations rather than one page:
Org settings for an Owner or an Admin, Your settings for everyone, since half
the Org controls are refused to a Member outright and a page that is mostly
greyed out reads as broken. The Tier is the one exception inside Org settings,
Owner only, and the entry is absent for an Admin rather than present and
refused. Platform administration is gated on the platform flag and never on a
Role, because a Platform Admin holds no Role inside any Org.

Onboarding is a flow driven by state the product can already observe — does this
person have a key, has any Turn arrived, does the Org have more than one Member
— and never by a stored step. That makes it resumable, survives a closed tab or
a sign-out halfway, and re-enters correctly when a Member installs on a second
machine. It also cannot lie: a flag says setup finished, observed state says a
Turn arrived, and those differ exactly when something has gone wrong. Each step
records what it shows while waiting, what it shows when it fails, and what the
person does next, because a Collector that never reports is the most likely
failure in the product and the flow has to name it rather than spin.

Every signed-in, signed-out and platform surface is listed with the ticket that
requires it and the Roles that may reach it, with each inferred Role marked as
inferred rather than quietly asserted. Four tickets disagree with each other or
with CONTEXT.md about who may act, and the file records both readings instead of
picking silently: retention (61 says Owner, CONTEXT gives an Admin every setting
but billing), and Members, Roles and invitations (49 and 50 say Owner, 46 says
Owner or Admin on the same surface).

Nineteen empty states are named with the sentence they show and the action they
offer. One requirement has no home: the failure recorded against a Session by
ticket 40 is displayed by no surface in the tracker, which the file states
plainly rather than placing by assumption.
