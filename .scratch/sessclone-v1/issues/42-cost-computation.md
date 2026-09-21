# 42: Cost computation and modifiers

**What to build:** An estimated Cost for any Turn, correct for the pricing modifiers that would otherwise silently halve or inflate it.

**Blocked by:** 29, 41.

**Status:** done

- [x] Each token class priced by its own rate
- [x] Fast mode, US-only inference, and the batch tier each applied from the Turn's own fields
- [x] Server-tool requests priced per request, separately from tokens
- [x] A model with no rate yields no Cost, never zero
- [x] Adding a rate later changes the computed Cost of an existing Turn
