import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Provider, ProviderCredential } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";
import { verifyGoogle } from "./providers/google";
import { verifyMeta } from "./providers/meta";
import { verifyAnthropic } from "./ai";

export async function listCredentials(userId: string): Promise<ProviderCredential[]> {
  const db = await getDb();
  return db.select().from(schema.providerCredentials).where(eq(schema.providerCredentials.userId, userId));
}

export async function getCredential(userId: string, provider: Provider) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.providerCredentials)
    .where(and(eq(schema.providerCredentials.userId, userId), eq(schema.providerCredentials.provider, provider)))
    .limit(1);
  return row ?? null;
}

/** Decrypted credentials for making provider calls, or null if none are saved. */
export async function getDecryptedCredential(userId: string, provider: Provider) {
  const row = await getCredential(userId, provider);
  if (!row) return null;
  return { clientId: row.clientId, clientSecret: decrypt(row.clientSecretEnc), status: row.status };
}

export async function verify(provider: Provider, clientId: string, clientSecret: string) {
  if (provider === "anthropic") return verifyAnthropic(clientSecret);
  return provider === "google" ? verifyGoogle({ clientId, clientSecret }) : verifyMeta({ clientId, clientSecret });
}

/**
 * Saves credentials and verifies them with the provider. An empty secret keeps the
 * stored one, so users can change the client ID without re-pasting the secret.
 */
export async function saveCredential(userId: string, provider: Provider, clientId: string, clientSecret: string | null) {
  const db = await getDb();
  const existing = await getCredential(userId, provider);
  const secret = clientSecret || (existing ? decrypt(existing.clientSecretEnc) : null);
  if (!secret) throw new Error("Enter the secret.");

  const result = await verify(provider, clientId, secret);
  const values = {
    clientId,
    clientSecretEnc: encrypt(secret),
    status: result.ok ? ("valid" as const) : ("invalid" as const),
    statusMessage: result.message,
    verifiedAt: new Date(),
    updatedAt: new Date(),
  };
  await db
    .insert(schema.providerCredentials)
    .values({ userId, provider, ...values })
    .onConflictDoUpdate({
      target: [schema.providerCredentials.userId, schema.providerCredentials.provider],
      set: values,
    });
  return result;
}

export async function reverifyCredential(userId: string, provider: Provider) {
  const creds = await getDecryptedCredential(userId, provider);
  if (!creds) throw new Error("No credentials saved.");
  return saveCredential(userId, provider, creds.clientId, creds.clientSecret);
}

export async function deleteCredential(userId: string, provider: Provider) {
  const db = await getDb();
  await db
    .delete(schema.providerCredentials)
    .where(and(eq(schema.providerCredentials.userId, userId), eq(schema.providerCredentials.provider, provider)));
}
