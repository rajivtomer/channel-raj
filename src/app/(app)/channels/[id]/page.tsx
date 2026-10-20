import Link from "next/link";
import { notFound } from "next/navigation";
import { ChannelProfileForm, ChannelSettingsForm } from "@/components/channel/ChannelSettingsForm";
import { ChannelRow } from "@/components/ChannelRow";
import { requireUser } from "@/lib/auth";
import { listChannels } from "@/lib/channels";

export const metadata = { title: "Channel settings" };

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const channel = (await listChannels(user.id)).find((c) => c.id === id);
  if (!channel) notFound();
  return (
    <div className="space-y-6">
      <header>
        <Link href="/settings/api" className="text-sm text-muted hover:text-ink">← API & channels</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{channel.name}</h1>
      </header>
      <ul className="card"><ChannelRow channel={channel} /></ul>
      <ChannelSettingsForm channel={channel} />
      <ChannelProfileForm channel={channel} />
    </div>
  );
}
