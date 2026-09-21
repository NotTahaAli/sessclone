import { afterAll, beforeEach } from 'vitest'

import { closeConnections, resetDatabase } from './harness'

// Ticket 25's "database reset between tests, so order does not matter", made
// structural rather than left to each file to remember. A file that forgets
// its own cleanup cannot leak rows into the next test, because the reset is
// not the file's to forget.
beforeEach(resetDatabase)

afterAll(closeConnections)
