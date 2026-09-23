// Ours, not Fumadocs'. `useAuthFields` persists every auth field to
// `localStorage` with no option to turn it off (fumadocs-openapi 12.0.2,
// `dist/playground/auth.js`; its docs offer only `storageKeyPrefix`). On
// this site that field is a SessClone API key: a live credential for the
// deployment, which must not outlive the tab in a store every script on the
// origin can read. So the playground forgets it: the key lives in the form
// and nowhere else, and is typed again after a reload.

/** Removes the stored value of each auth field. Storage that throws (a
 * private window, blocked site data) has nothing to forget. */
export const forgetAuth = (
  storage: Pick<Storage, 'removeItem'> | undefined,
  fields: readonly { storageKey: string }[],
) => {
  try {
    for (const field of fields) storage?.removeItem(field.storageKey)
  } catch {
    // Nothing was stored, so nothing is left behind.
  }
}
