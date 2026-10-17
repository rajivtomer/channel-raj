"use client";

import { useState, useTransition } from "react";
import { checkAllChannelsAction, type ActionResult } from "@/app/actions/settings";

export function CheckAllButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>();
  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className={`text-xs ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {result.message}
        </span>
      )}
      <button className="btn-ghost" disabled={pending} onClick={() => start(async () => setResult(await checkAllChannelsAction()))}>
        {pending ? "Checking…" : "Check all"}
      </button>
    </div>
  );
}
