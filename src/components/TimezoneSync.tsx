"use client";

import { useEffect } from "react";
import { adoptTimezoneAction } from "@/app/actions/ai";

/** Saves the browser's time zone once, so queue times and best-time suggestions match the user's clock. */
export function TimezoneSync({ known }: { known: boolean }) {
  useEffect(() => {
    if (known) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) adoptTimezoneAction(tz).catch(() => undefined);
  }, [known]);
  return null;
}
