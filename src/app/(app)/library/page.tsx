import { MediaLibrary } from "@/components/media/MediaLibrary";
import { requireUser } from "@/lib/auth";
import { blobEnabled, listMedia } from "@/lib/media";

export const metadata = { title: "Media library" };

export default async function LibraryPage() {
  const user = await requireUser();
  const assets = await listMedia(user.id);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Media library</h1>
        <p className="mt-1 text-sm text-muted">Upload once, use in any post. Drag files anywhere on this page.</p>
      </header>
      {!blobEnabled() && process.env.VERCEL && (
        <p className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          File storage isn’t set up yet. In your Vercel project, open Storage, create a Blob store and connect it to this project, then redeploy.
        </p>
      )}
      <MediaLibrary initial={assets} userId={user.id} blob={blobEnabled()} />
    </div>
  );
}
