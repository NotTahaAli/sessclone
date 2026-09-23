// Settings: the index of destinations, listed according to what the Role
// reaches.
//
// They are separate destinations rather than sections of one page, for the
// reason `docs/design/product-ia.md` gives at length: a page that is mostly
// refused reads as broken. So Org settings is *absent* for a Manager or a
// Member rather than present and disabled.
//
// Since ticket 113 the index itself is the settings layout's column
// (`settings-index.tsx`): on a phone it is this page, and on desktop it sits
// on the left with this page's place on the right empty until a row is
// picked.

export default function Settings() {
  return (
    <p className="text-text-muted hidden pt-3 text-body lg:block">
      Pick a setting on the left.
    </p>
  )
}
