import { cookies } from 'next/headers'

import { applyAppearanceSource } from '../appearance-script'
import {
  APPEARANCE_COOKIE,
  encodeAppearance,
  viewerAppearance,
} from '../../lib/appearance'
import { asViewer } from '../../lib/db'
import { currentViewer } from '../../lib/viewer'

// Ticket 77: what keeps the cookie honest.
//
// The cookie is the delivery mechanism for a theme that has to be applied
// before the first paint (`appearance-script.tsx` says why it cannot be a
// server-rendered attribute). It is written when a Member saves and at
// sign-in, and there are two ways it then falls behind the database:
//
//  - **A new browser.** Somebody signs in on their phone; the sign-in callback
//    writes it, so this is only the path where that cookie was cleared.
//  - **The Org changed its colour.** That write lands on an Owner's browser
//    and changes what every other Member sees, and nothing can reach their
//    cookies until they come back.
//
// So this compares the two on each full load of the shell and, when they
// disagree, emits a script that applies the right values and writes them into
// the cookie, so the next load needs none of this. That load alone paints its
// first frame with the old accent — a single flash, on the load after somebody
// else changed something, rather than the wrong colour for a year.
//
// It renders inside the shell's existing Suspense boundary, so the frame still
// prerenders: this reads the session, and nothing above it does.
export async function AppearanceSync() {
  const viewer = await currentViewer()
  if (!viewer) return null

  const appearance = await asViewer(viewer.userId, viewerAppearance)
  const wanted = encodeAppearance(appearance)
  const carried = (await cookies()).get(APPEARANCE_COOKIE)?.value

  if (carried === wanted) return null

  // A new object per render, which the rule is right about in general and
  // wrong about here: this is a server component, so there is no second render
  // to memoise for, and the value it carries differs per request.
  // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
  const html = { __html: applyAppearanceSource(wanted) }
  // oxlint-disable-next-line no-danger
  return <script dangerouslySetInnerHTML={html} />
}
