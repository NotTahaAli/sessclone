// PageHeader, from the design system's inventory: title and a one-line
// description.
//
// The inventory also lists an action slot and a control slot, and neither is
// built here: nothing under this shell has an action or a control yet, and the
// control slot exists for ticket 53's date-range control. They arrive with the
// first caller that has something to put in them, which is also the first
// caller that can say what the slot has to hold.

export function PageHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <header className="border-rule flex flex-wrap items-end justify-between gap-4 border-b pb-4">
      <div>
        <h1 className="text-heading-lg">{title}</h1>
        {description ? (
          <p className="text-text-secondary mt-1 text-body">{description}</p>
        ) : null}
      </div>
    </header>
  )
}
