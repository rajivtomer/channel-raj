import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { appUrl } from "@/lib/config";
import { randomToken } from "@/lib/crypto";
import { getDecryptedCredential } from "@/lib/credentials";
import { backToSettings, providerParam, stateCookie } from "@/lib/oauth";
import { googleAuthorizeUrl } from "@/lib/providers/google";
import { metaAuthorizeUrl } from "@/lib/providers/meta";

export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login?next=/settings/api`);

  const parsed = providerParam.safeParse((await params).provider);
  if (!parsed.success) return backToSettings({ error: "Unknown provider." });
  const provider = parsed.data;

  const creds = await getDecryptedCredential(user.id, provider);
  if (!creds) return backToSettings({ error: "Save your API credentials before connecting channels." });
  if (creds.status === "invalid") return backToSettings({ error: "Fix your API credentials before connecting channels." });

  // State binds the callback to this browser and this user.
  const state = `${user.id}.${randomToken(24)}`;
  (await cookies()).set(stateCookie(provider), state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/api/oauth/${provider}`,
    maxAge: 600,
  });
  const url = provider === "google" ? googleAuthorizeUrl(creds.clientId, state) : metaAuthorizeUrl(creds.clientId, state);
  return NextResponse.redirect(url);
}
