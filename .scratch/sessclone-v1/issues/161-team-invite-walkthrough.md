# 161: Team walkthrough fixes: Role picker, join page, no-Org page

**What to build:** coordinator, 2026-10-01, overnight while Taha slept. Walk the
Team buyer path at 390px and 1440px (an approved Owner invites a teammate, the
teammate signs in from the link and accepts, gets a key, sets up a machine; Role
changes, removal, the Org switcher) and fix the friction and bugs found.

**What was found.**

- After saving a Role, the Role picker went back to the old Role while the row
  under it said the new one. React resets a form once its action settles, and
  a reset returns a select to the option it was first drawn with. Removing a
  Manager showed "Member" on the picker the same way.
- A refusal beside a person's controls (the last-Owner rule) widened the
  controls column until the person's name was one letter on a phone.
- The join page never said which Org the invitation was to. `/sign-in` already
  did (ticket 77).
- Signed in as the wrong address, the join page said so and offered no way to
  sign out and come back as the right one.
- Somebody signed in with no Org (signed up from an invitation and opened the
  dashboard before accepting, or removed from their only Org) saw "No Org yet"
  with no invitation, no New Org, no Sign out, and a sentence telling them to
  sign out and back in to make an Org they may not want.
- The invitation link sat in a readonly field showing a third of the URL on a
  phone, with no Copy.

**What was decided.**

- The Role form is keyed by the Role and removal it shows, so a save draws a
  fresh form; `onReset` keeps a refused pick in step with the select.
- The refusal is capped in width and wraps under the controls.
- The join page names the Org with its mark, both signed in and out, from the
  same anonymous token read `/sign-in` uses. Signed in, "Not you? Sign out"
  signs out and returns to `/sign-in?next=/join/<token>`. `signOut` only
  carries a `next` that is an invitation path.
- The no-Org page lists the person's pending invitations with Accept and
  Decline (the switcher's rows), and offers New Org and Sign out. The
  "database not reachable" sentence only shows when the invitations cannot be
  read.
- The invitation link is the Keys page's code block: wrapped, with Copy.
- No schema change.

**Status:** done

- [x] Role picker keeps the saved Role; e2e test red without the fix
- [x] No-Org page accepts an invitation; e2e test red without the fix
- [x] Join page names the Org, and signs out back to the invitation
- [x] Refusal wraps; invitation link has Copy (checked by screenshot)
