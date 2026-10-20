import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the cookie token, so a database leak does not leak live sessions.
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export type Provider = "google" | "meta";
export type CredentialStatus = "unverified" | "valid" | "invalid";

/** A user's own developer app credentials for one provider. */
export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<Provider>().notNull(),
    clientId: text("client_id").notNull(),
    clientSecretEnc: text("client_secret_enc").notNull(),
    status: text("status").$type<CredentialStatus>().notNull().default("unverified"),
    statusMessage: text("status_message"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("provider_credentials_user_provider_idx").on(t.userId, t.provider)],
);

export type Platform = "youtube" | "facebook" | "instagram";
export type ChannelStatus = "connected" | "expired" | "error";

/** A connected YouTube channel, Facebook Page or Instagram professional account. */
export const channels = pgTable(
  "channels",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    handle: text("handle"),
    avatarUrl: text("avatar_url"),
    followers: integer("followers"),
    // Instagram accounts are reached through the Facebook Page they are linked to.
    parentExternalId: text("parent_external_id"),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    status: text("status").$type<ChannelStatus>().notNull().default("connected"),
    statusMessage: text("status_message"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    settings: jsonb("settings").$type<ChannelSettings>().notNull().default({}),
    connectedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("channels_user_platform_external_idx").on(t.userId, t.platform, t.externalId),
    index("channels_user_idx").on(t.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type ProviderCredential = typeof providerCredentials.$inferSelect;
export type Channel = typeof channels.$inferSelect;

/** Per-channel defaults applied when composing. Platform-specific keys are optional. */
export interface ChannelSettings {
  defaultHashtags?: string;
  captionSuffix?: string;
  firstComment?: string;
  youtube?: {
    privacy?: "public" | "unlisted" | "private";
    categoryId?: string;
    tags?: string;
    madeForKids?: boolean;
    playlistId?: string;
    notifySubscribers?: boolean;
  };
}

export type MediaKind = "image" | "video";

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    pathname: text("pathname").notNull(),
    filename: text("filename").notNull(),
    kind: text("kind").$type<MediaKind>().notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSec: integer("duration_sec"),
    createdAt: createdAt(),
  },
  (t) => [index("media_assets_user_idx").on(t.userId, t.createdAt)],
);

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed";

export const posts = pgTable(
  "posts",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    caption: text("caption").notNull().default(""),
    mediaIds: jsonb("media_ids").$type<string[]>().notNull().default([]),
    status: text("status").$type<PostStatus>().notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("posts_user_idx").on(t.userId, t.scheduledAt), index("posts_due_idx").on(t.status, t.scheduledAt)],
);

/** Platform-specific options for one target. */
export interface TargetOptions {
  youtube?: {
    title?: string;
    tags?: string;
    privacy?: "public" | "unlisted" | "private";
    categoryId?: string;
    madeForKids?: boolean;
    playlistId?: string;
    thumbnailAssetId?: string;
    notifySubscribers?: boolean;
  };
  instagram?: { format?: "feed" | "reel" | "story"; shareToFeed?: boolean };
  facebook?: { link?: string };
  firstComment?: string;
}

export type TargetStatus = "pending" | "processing" | "published" | "failed";

export const postTargets = pgTable(
  "post_targets",
  {
    id: id(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    caption: text("caption"),
    options: jsonb("options").$type<TargetOptions>().notNull().default({}),
    status: text("status").$type<TargetStatus>().notNull().default("pending"),
    // Instagram media containers are processed asynchronously; we poll them.
    containerId: text("container_id"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    error: text("error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("post_targets_post_channel_idx").on(t.postId, t.channelId),
    index("post_targets_processing_idx").on(t.status, t.nextCheckAt),
  ],
);

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostTarget = typeof postTargets.$inferSelect;
