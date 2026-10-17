"use client";

import { useState, useTransition } from "react";
import { checkChannelAction, disconnectChannelAction } from "@/app/actions/settings";
import type { PublicChannel } from "@/lib/channels";
import { PLATFORM_LABEL, PlatformIcon } from "./icons";
import { StatusBadge } from "./StatusBadge";

const fmt = new Intl.NumberFormat("en", { notation: "compact" });

export function ChannelRow({ channel, manage = true }: { channel: PublicChannel; manage?: boolean }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; message: string }>();
  const tone = channel.status === "connected" ? "green" : channel.status === "expired" ? "amber" : "red";
  const label = channel.status === "connected" ? "Connected" : channel.status === "expired" ? "Reconnect needed" : "Error";

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="relative">
        {channel.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={channel.avatarUrl} alt="" className="size-10 rounded-full object-cover" />
        ) : (
          <div className="size-10 rounded-full bg-bg" />
        )}
        <PlatformIcon platform={channel.platform} className="absolute -right-1 -bottom-1 size-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{channel.name}</p>
        <p className="truncate text-xs text-muted">
          {PLATFORM_LABEL[channel.platform]}
          {channel.handle ? ` · ${channel.handle.startsWith("@") ? channel.handle : "@" + channel.handle}` : ""}
          {channel.followers != null ? ` · ${fmt.format(channel.followers)} ${channel.platform === "youtube" ? "subscribers" : "followers"}` : ""}
        </p>
        {(note || channel.statusMessage) && (
          <p className={`mt-1 text-xs ${note?.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {note?.message ?? channel.statusMessage}
          </p>
        )}
      </div>
      <StatusBadge tone={tone}>{label}</StatusBadge>
      {manage && (
        <div className="flex gap-2">
          <button
            className="btn-ghost px-2.5 py-1.5 text-xs"
            disabled={pending}
            onClick={() => start(async () => setNote(await checkChannelAction(channel.id)))}
          >
            {pending ? "Checking…" : "Check"}
          </button>
          <button
            className="btn-danger px-2.5 py-1.5 text-xs"
            disabled={pending}
            onClick={() => {
              if (confirm(`Disconnect ${channel.name}? You can reconnect it later.`))
                start(async () => void (await disconnectChannelAction(channel.id)));
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </li>
  );
}
