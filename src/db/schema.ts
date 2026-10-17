import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
