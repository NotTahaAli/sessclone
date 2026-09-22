# 85: Grouped navigation, with the admin panel in it

**What to build:** The dashboard's navigation becomes three groups rather than one flat list of four, so the surfaces added by 86, 87 and 88 have somewhere to live.

Ticket 45 built four destinations — Costs, Keys, Devices, Settings — which `navigation.ts` calls all four because that is what fits the phone bottom bar. Sessions and Transcripts make six, and six flat items read as a list of everything rather than as a product.

The groups, decided by Taha on 2026-09-22:

1. **Costs, Sessions, Transcripts** — what the product is for.
2. **Keys, Devices** — what you set up once, and revisit when a machine changes.
3. **Settings**, plus **Admin panel** when the viewer is a platform admin.

The admin entry is the one conditional item, and it is conditional on `is_platform_admin` rather than on a Role: the platform admin page (ticket 65) already exists and is reachable only by typing its path. A viewer who is not one sees no group-three entry beyond Settings, and no hint that one exists.

The phone bottom bar cannot carry six items, so it carries group one plus a **More** entry that opens the rest. That keeps the surfaces a person uses daily one tap away and the setup surfaces one tap further.

**Blocked by:** 45, 65.

**Status:** open

- [ ] The sidebar renders three labelled groups in the order above
- [ ] Admin panel appears for a platform admin and for nobody else, proven against the flag rather than through the UI
- [ ] The phone bottom bar shows Costs, Sessions, Transcripts and More; More reaches Keys, Devices, Settings and, when entitled, Admin panel
- [ ] The current destination is marked in both layouts, including when it is behind More
- [ ] Screenshots at 1440x900 and 390x844, light and dark
