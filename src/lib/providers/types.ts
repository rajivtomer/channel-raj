import type { Platform } from "@/db/schema";

export interface DiscoveredChannel {
  platform: Platform;
  externalId: string;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  followers?: number | null;
  parentExternalId?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scopes?: string | null;
}

export interface ChannelSnapshot {
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  followers?: number | null;
  /** Set when the token was refreshed during the check. */
  accessToken?: string;
  tokenExpiresAt?: Date | null;
}

export interface VerifyResult {
  ok: boolean;
  message: string;
}
