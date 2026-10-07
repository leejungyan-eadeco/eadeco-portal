"use client";

import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { btn, field } from "../ui";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);

  return (
    <form action={action} className="mt-8 grid gap-5">
      <input type="hidden" name="next" value={next} />
      {state && (
        <p role="alert" className="flex gap-2.5 rounded-lg bg-bad-soft px-3.5 py-3 text-sm text-bad">
          <WarningCircle size={18} weight="fill" className="mt-px shrink-0" />
          {state.error}
        </p>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Username</span>
        {/* The domain is fixed, so it sits inside the box instead of being explained. Typing it anyway still works. */}
        <span className="flex overflow-hidden rounded-lg border border-line-strong bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          <span className="flex items-center border-r border-line bg-subtle px-3 text-sm text-ink-2 select-none">EADECO</span>
          <input
            name="username"
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus={!state}
            defaultValue={state?.username}
            key={state?.username}
            placeholder="Your Windows username"
          />
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Password</span>
        <input name="password" type="password" className={field} autoComplete="current-password" required autoFocus={!!state} />
      </label>
      <button type="submit" className={`${btn.primary} w-full py-2.5 disabled:opacity-60`} disabled={pending}>
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
