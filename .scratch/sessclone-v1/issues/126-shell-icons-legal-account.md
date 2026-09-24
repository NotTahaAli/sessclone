# 126: Shell icons, the legal line and an always-shown account

**What to build:** Taha, 2026-09-23. Nav items get icons and the group headings read as section labels. The panel credit becomes one line that opens the full legal notices. The avatar menu gives way to an account block that is always shown.

**Where the ask forks, and what was picked.**

- lucide-react icons, 16px, stroke 1.5, `aria-hidden`. On the phone bar each icon sits above its label. Items name their icon as a string, because they cross from the server into client links.
- Legal is a native popover (`popovertarget`), so it needs no JavaScript. Each frame renders the notice once. The section 7(b) term in `NOTICE.md` is unchanged.
- On desktop, the account block sits at the sidebar foot and carries Sign out and Legal; the credit under it leaves out its own Legal. On a phone, the block is at the top of More.

**Blocked by:** 112.

**Status:** done

- [x] Icons and headings: sidebar, bottom bar, More, admin
- [x] Credit line and popover; panel-credit tests updated
- [x] Account block; Sign out still a plain form post
- [x] Screenshots at 1440 and 390, light and dark
