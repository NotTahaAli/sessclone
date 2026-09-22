import { permanentRedirect } from 'next/navigation'

// Ticket 87: the transcripts moved to `/transcripts`.
//
// A redirect rather than a deletion, because the link has shipped: ticket 84's
// team listing has been reachable at this path, and a 404 would strand
// whoever bookmarked it or was sent it. `permanentRedirect` is a 308, which is
// what this is — the page is not coming back here.
//
// The query is deliberately not carried. The only parameters this path took
// were `member`, `project` and `before`, and the destination reads all three
// under the same names, so Next's own behaviour of preserving the search
// string is what makes an opened group land on the same group.
export default function MovedToTranscripts() {
  permanentRedirect('/transcripts')
}
