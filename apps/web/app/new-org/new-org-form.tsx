'use client'

import Link from 'next/link'
import {
  startTransition,
  useActionState,
  useCallback,
  type FormEvent,
  type ReactNode,
} from 'react'

import { NAME_LIMIT } from '../../lib/names'
import { createOrg } from '../(dashboard)/org-actions'
import { buttonClass, inputClass } from '../_ui/primitives'

const LABEL = 'text-text-secondary text-caption'

/** The New Org form (ticket 136). `plans` is sign-up's plan step, or null
 * wherever sign-up skips it. A form posting to a Server Action, so it works
 * before JavaScript; `useActionState` adds the refusal's sentence.
 *
 * Once hydrated it submits from `onSubmit`: an `action` prop resets the
 * fields when the action returns, and a refusal would clear the name and the
 * plan it is about. */
export function NewOrgForm({ plans }: { plans: ReactNode }) {
  const [state, action, pending] = useActionState(createOrg, null)
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      startTransition(() => action(data))
    },
    [action],
  )
  return (
    <form
      action={action}
      onSubmit={submit}
      className="mt-6 flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Name</span>
        <input
          name="name"
          required
          maxLength={NAME_LIMIT}
          autoComplete="organization"
          placeholder="Acme"
          className={`${inputClass} w-full`}
        />
      </label>
      {plans ? (
        <div className="flex flex-col gap-1.5">
          <span aria-hidden="true" className={LABEL}>
            Plan
          </span>
          {plans}
        </div>
      ) : null}
      {state ? (
        <p role="alert" className="text-bad-text text-caption">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass('primary')} w-full`}
      >
        {pending ? 'Creating…' : 'Create Org'}
      </button>
      <Link
        href="/costs"
        className="text-text-muted hover:text-text self-center text-caption underline"
      >
        Cancel
      </Link>
    </form>
  )
}
