import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appUrl } from "./config";

export const providerParam = z.enum(["google", "meta"]);

export const stateCookie = (provider: string) => `ct_oauth_${provider}`;

/** Redirect back to the API settings page with a flash message in the query string. */
export function backToSettings(params: Record<string, string>) {
  return NextResponse.redirect(`${appUrl()}/settings/api?${new URLSearchParams(params)}`, { status: 303 });
}
