import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { upsertChannels } from "@/lib/channels";
import { appUrl } from "@/lib/config";
import { getDecryptedCredential } from "@/lib/credentials";
import { backToSettings, providerParam, stateCookie } from "@/lib/oauth";
import { exchangeGoogleCode } from "@/lib/providers/google";
import { exchangeMetaCode } from "@/lib/providers/meta";

function sameString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login?next=/settings/api`);

  const parsed = providerParam.safeParse((await params).provider);
  if (!parsed.success) return backToSettings({ error: "Unknown provider." });
  const provider = parsed.data;

  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get(stateCookie(provider))?.value;
  jar.delete({ name: stateCookie(provider), path: `/api/oauth/${provider}` });

  const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (denied) return backToSettings({ error: `Connection was cancelled: ${denied}` });

  const state = url.searchParams.get("state") ?? "";
  if (!expected || !sameString(state, expected) || !state.startsWith(`${user.id}.`)) {
    return backToSettings({ error: "The connection link expired or was opened in another browser. Try again." });
  }
  const code = url.searchParams.get("code");
  if (!code) return backToSettings({ error: "The provider did not return an authorization code." });

  const creds = await getDecryptedCredential(user.id, provider);
  if (!creds) return backToSettings({ error: "Your API credentials were removed. Save them and try again." });

  try {
    const found = provider === "google" ? await exchangeGoogleCode(creds, code) : await exchangeMetaCode(creds, code);
    const count = await upsertChannels(user.id, found);
    return backToSettings({ connected: String(count), provider });
  } catch (err) {
    return backToSettings({ error: (err as Error).message });
  }
}
