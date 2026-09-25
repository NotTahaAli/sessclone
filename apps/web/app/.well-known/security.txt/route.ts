import { connection } from 'next/server'

import { securityTxt } from '../../../lib/security-txt'

export async function GET() {
  // At request time, not at build: Expires counts from now.
  await connection()
  return new Response(securityTxt(new Date()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
