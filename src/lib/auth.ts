import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/db";
import type { User } from "@/db/schema";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "ct_session";
const SESSION_DAYS = 30;

export async function createSession(userId: string): Promise<void> {
  const db = await getDb();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt });
  // Opportunistically clear expired sessions for this user.
  await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), lt(schema.sessions.expiresAt, new Date())));
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

export type SessionUser = Pick<User, "id" | "email" | "name" | "preferences">;

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, preferences: schema.users.preferences })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function savePreferences(userId: string, patch: Partial<User["preferences"]>) {
  const db = await getDb();
  const [row] = await db.select({ preferences: schema.users.preferences }).from(schema.users).where(eq(schema.users.id, userId));
  const next = { ...row?.preferences, ...patch };
  await db.update(schema.users).set({ preferences: next }).where(eq(schema.users.id, userId));
  return next;
}
