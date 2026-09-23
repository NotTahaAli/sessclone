import { contactEmail } from '../../lib/site'

// Ordinary constants, beside the pages rather than inside `layout.tsx`: Next
// treats that file specially, and a module a framework owns is a poor home
// for a string two siblings import.

/** Upstream, and fixed: the source every deployment is conveyed from. */
export const REPOSITORY = 'https://github.com/NotTahaAli/sessclone'

/** Where a visitor with no address to write to can still ask. */
export const ISSUES = `${REPOSITORY}/issues`

/**
 * This deployment's contact address, `NEXT_PUBLIC_CONTACT_EMAIL`, or null.
 * No fallback (2026-09-23): a self-hosted copy must never send its visitors
 * to somebody else's inbox, so every consumer hides or replaces the link.
 */
export const CONTACT_EMAIL = contactEmail()

/** The pages' width and gutters, shared by the nav, each page and the footer:
 * 16px on a phone, as Direction A's frames draw it. */
export const FRAME = 'mx-auto w-full max-w-[1200px] px-4 sm:px-8 lg:px-14'
