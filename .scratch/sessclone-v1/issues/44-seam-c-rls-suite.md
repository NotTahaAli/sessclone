# 44: RLS policy test suite

**What to build:** Proof, in SQL, that the Role rules hold — tested where they live rather than through the application.

**Blocked by:** 11, 21, 22, 23, 24, 25.

**Status:** done

- [x] A Member reads only their own Turns and artifacts
- [x] A Manager reads exactly their Scope; a Manager with an empty Scope reads nothing
- [x] An Admin and an Owner read the whole Org
- [x] No Role reads another Org at all
- [x] A Member cannot change their own Role
- [x] Every table added later is expected to extend this suite
