import "server-only";
import type { Platform, Provider } from "@/db/schema";

export function appUrl(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return (process.env.APP_URL || (vercel ? `https://${vercel}` : "http://localhost:3000")).replace(/\/$/, "");
}

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

// API hosts. Overridable so the publishing engine can be exercised against a local mock.
export const API = {
  graph: (process.env.META_GRAPH_BASE || "https://graph.facebook.com") + "/" + META_GRAPH_VERSION,
  googleToken: process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
  googleApis: process.env.GOOGLE_API_BASE || "https://www.googleapis.com",
};

export function redirectUri(provider: Provider): string {
  return `${appUrl()}/api/oauth/${provider}/callback`;
}

export const PROVIDERS: Record<
  Provider,
  {
    label: string;
    platforms: Platform[];
    clientIdLabel: string;
    clientSecretLabel: string;
    consoleUrl: string;
    setupSteps: string[];
  }
> = {
  google: {
    label: "Google (YouTube)",
    platforms: ["youtube"],
    clientIdLabel: "OAuth client ID",
    clientSecretLabel: "OAuth client secret",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    setupSteps: [
      "Create a project in Google Cloud Console.",
      "Enable YouTube Data API v3 and YouTube Analytics API.",
      "Configure the OAuth consent screen and add yourself as a test user.",
      "Create an OAuth client ID of type “Web application” and add the redirect URI below.",
    ],
  },
  meta: {
    label: "Meta (Facebook + Instagram)",
    platforms: ["facebook", "instagram"],
    clientIdLabel: "App ID",
    clientSecretLabel: "App secret",
    consoleUrl: "https://developers.facebook.com/apps",
    setupSteps: [
      "Create a Business app at developers.facebook.com.",
      "Add the “Facebook Login for Business” and “Instagram” products.",
      "Add the redirect URI below under Valid OAuth Redirect URIs.",
      "Make sure each Instagram account is a Business or Creator account linked to a Facebook Page.",
    ],
  },
};

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "pages_manage_engagement",
  "read_insights",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
];
