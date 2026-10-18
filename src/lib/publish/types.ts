import type { Channel, MediaAsset, TargetOptions } from "@/db/schema";

export interface PublishInput {
  channel: Channel;
  accessToken: string;
  appSecret: string;
  caption: string;
  media: MediaAsset[];
  options: TargetOptions;
}

export type PublishOutcome =
  | { state: "published"; externalId: string; externalUrl?: string | null; warnings?: string[] }
  | { state: "processing"; containerId: string; retryInSec: number }
  | { state: "failed"; error: string };
