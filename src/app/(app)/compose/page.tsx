import { notFound } from "next/navigation";
import { Composer } from "@/components/compose/Composer";
import { requireUser } from "@/lib/auth";
import { listChannels } from "@/lib/channels";
import { blobEnabled, listMedia } from "@/lib/media";
import { getPost } from "@/lib/posts";

export const metadata = { title: "Compose" };
// Publishing a large video can take a while.
export const maxDuration = 300;

const TITLES = { draft: "Edit draft", scheduled: "Edit scheduled post", failed: "Fix and retry", publishing: "Publishing", published: "Published post", partial: "Partly published" } as const;

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ id?: string; date?: string; saved?: string }> }) {
  const user = await requireUser();
  const { id, date, saved } = await searchParams;
  const [channels, library, post] = await Promise.all([
    listChannels(user.id),
    listMedia(user.id),
    id && /^[0-9a-f-]{36}$/.test(id) ? getPost(user.id, id) : Promise.resolve(null),
  ]);
  if (id && !post) notFound();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{post ? TITLES[post.status] : "Create post"}</h1>
        <p className="mt-1 text-sm text-muted">One post, every channel. Adjust details per platform before it goes out.</p>
      </header>
      <Composer key={post?.id ?? "new"} channels={channels.filter((c) => c.status === "connected" || post?.targets.some((t) => t.channelId === c.id))} library={library} post={post} userId={user.id} blob={blobEnabled()} initialDate={/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : undefined} flash={post && saved ? saved.slice(0, 200) : undefined} />
    </div>
  );
}
