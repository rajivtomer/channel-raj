import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/icons";
import { getCurrentUser } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 font-semibold">
          <Logo /> Channel Toolkit
        </Link>
        <div className="card p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
