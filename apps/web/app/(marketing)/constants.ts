// Ordinary constants, beside the pages rather than inside `layout.tsx`: Next
// treats that file specially, and a module a framework owns is a poor home
// for a string two siblings import.
export const REPOSITORY = 'https://github.com/NotTahaAli/sessclone'
export const CONTACT_EMAIL = 'hello@sessclone.com'

/** The pages' width and gutters, shared by the nav, each page and the footer:
 * 16px on a phone, as Direction A's frames draw it. */
export const FRAME = 'mx-auto w-full max-w-[1200px] px-4 sm:px-8 lg:px-14'
