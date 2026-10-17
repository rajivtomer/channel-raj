import { login } from "@/app/actions/auth";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-muted">Log in to manage your channels.</p>
      <AuthForm mode="login" action={login} next={next} />
    </>
  );
}
