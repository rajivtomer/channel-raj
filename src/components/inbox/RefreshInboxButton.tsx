"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { refreshInboxAction } from "@/app/actions/inbox";

export function RefreshInboxButton({ label = "Check for new comments" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; message: string }>();
  return (
    <div className="flex items-center gap-3">
      {note && <span role="status" className={`text-xs ${note.ok ? "text-muted" : "text-red-600 dark:text-red-400"}`}>{note.message}</span>}
      <button
        className="btn-ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setNote(await refreshInboxAction());
            router.refresh();
          })
        }
      >
        {pending ? "Checking…" : label}
      </button>
    </div>
  );
}
