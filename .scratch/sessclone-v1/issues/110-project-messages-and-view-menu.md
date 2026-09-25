# 110: Claude Project messages and the view menu

**What to build:** Taha, 2026-09-23: "support the heart beat mcp events", then "use icons in header. Like put reload in the hedder instead of hidden. Also Thinking and Preset can go in header too, but show neatly, not as separate buttons", and "make it fill the container."

**Where the ask forks, and what was picked (Taha's picks).**

- A hearthbot `reply` renders as Claude's message: markdown, copy, time, and its attached outputs as chips.
- Every `update_status` renders as a checklist card, one per update.
- An `update_message` changes the message it names to its latest text. "edited" under it opens every version with its time.
- `react` and `unreact` put the current emoji under the message they name. The message's info popup lists the full reaction history.
- `ask_decision` renders as a card: question, context, options with consequences, the recommended one marked, and the reason.
- `no_reply_needed` and the other hearthbot calls stay folded among the steps. An MCP tool reads as `server · tool`.
- The header holds icon buttons: back and a visible Reload. Preset and thinking mode share one pill that opens a menu, as Claude's model picker does. The filter chips and saved presets sit one step further in.
- The chat fills the column's width.

**Blocked by:** 109

**Status:** done

- [x] Replies, edits, reactions, status and decision cards
- [x] Header icons and view menu; full width
