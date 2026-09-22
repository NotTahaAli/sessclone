import { notFound } from 'next/navigation'

import { storedProjects, storedSessions } from '../../../../lib/artifacts'
import { StoredTranscripts } from '../you/stored-transcripts'
import { PageHeader } from '../../page-header'
import { asViewer } from '../../../../lib/db'
import { currentViewer, reachesTeamTranscripts } from '../../../../lib/viewer'

// Ticket 84: the Org-side listing of stored transcripts.
//
// Ticket 60 built the download and `log_artifacts_read` already answers it for
// every Role entitled to a transcript — an Owner or Admin for any Member, a
// Manager for their Scope. What was missing was a surface: the only listing
// was a Member's own, so another Member's transcript was reachable by its id
// and browsable by nobody.
//
// Read-only on purpose, and that is ADR 0005 rather than a simplification:
// `log_artifacts_delete` is `sessclone_own_member_ids()`, so a transcript is
// the Member's own to destroy. An Admin may read one and may not remove it,
// and this page therefore renders no Delete control at all.
//
// The Role check here is navigation, not authorisation: what a Manager
// actually sees is whatever `sessclone_visible_member_ids()` returns for them
// (ADR 0001), which is their Scope and nothing else — with an empty Scope this
// page is empty rather than refused.

export default async function TeamTranscripts() {
  const viewer = await currentViewer()
  if (!viewer || !reachesTeamTranscripts(viewer.role)) notFound()

  // One transaction, two independent statements, as `/settings/you` does it.
  const [projects, sessions] = await asViewer(viewer.userId, (tx) =>
    Promise.all([
      storedProjects(tx, 'team'),
      storedSessions(tx, undefined, 'team'),
    ]),
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Team transcripts"
        description={`Transcripts stored by the people you can see in ${viewer.orgName}. A transcript is the Member's own to delete, so these can be read and not removed from here.`}
      />

      <StoredTranscripts
        projects={projects}
        sessions={sessions.sessions}
        more={sessions.more}
        audience="team"
        // One Org per viewer, so there is nothing to tell apart here.
        orgNames={new Map()}
      />
    </div>
  )
}
