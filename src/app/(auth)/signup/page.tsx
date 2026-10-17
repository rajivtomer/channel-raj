import { signup } from "@/app/actions/auth";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-muted">Connect YouTube, Instagram and Facebook in a few minutes.</p>
      <AuthForm mode="signup" action={signup} />
    </>
  );
}
