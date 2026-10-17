"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "login" | "signup";
  action: (state: FormState, form: FormData) => Promise<FormState>;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isSignup = mode === "signup";
  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {isSignup && (
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" name="name" className="input" autoComplete="name" required defaultValue={state?.fields?.name} />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required defaultValue={state?.fields?.email} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete={isSignup ? "new-password" : "current-password"}
          minLength={isSignup ? 8 : undefined}
          required
        />
        {isSignup && <p className="mt-1 text-xs text-muted">At least 8 characters.</p>}
      </div>
      {state?.error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Please wait…" : isSignup ? "Create account" : "Log in"}
      </button>
      <p className="text-center text-sm text-muted">
        {isSignup ? "Already have an account? " : "New here? "}
        <Link className="font-medium text-brand hover:underline" href={isSignup ? "/login" : "/signup"}>
          {isSignup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
