import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo, PlatformIcon } from "@/components/icons";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="flex items-center gap-2 font-semibold">
          <Logo /> Channel Toolkit
        </span>
        <nav className="flex gap-2">
          <Link className="btn-ghost" href="/login">Log in</Link>
          <Link className="btn-primary" href="/signup">Get started</Link>
        </nav>
      </header>
      <section className="flex flex-1 flex-col items-center justify-center py-20 text-center">
        <div className="mb-6 flex gap-3">
          <PlatformIcon platform="youtube" className="size-10" />
          <PlatformIcon platform="instagram" className="size-10" />
          <PlatformIcon platform="facebook" className="size-10" />
        </div>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Run every channel from one control room.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted">
          Connect your own YouTube, Instagram and Facebook apps, then publish, schedule, automate and track everything in one place.
        </p>
        <Link className="btn-primary mt-8 px-5 py-2.5 text-base" href="/signup">Create a free account</Link>
      </section>
    </main>
  );
}
