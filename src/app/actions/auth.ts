"use server";

import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { createSession, destroySession } from "@/lib/auth";

export type FormState = { error?: string; fields?: Record<string, string> } | undefined;

const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for your password.").max(200),
});

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const raw = Object.fromEntries(form) as Record<string, string>;
  const parsed = signupSchema.safeParse(raw);
  const fields = { name: raw.name ?? "", email: raw.email ?? "" };
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, fields };

  const db = await getDb();
  const taken = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${parsed.data.email}`)
    .limit(1);
  if (taken.length) return { error: "An account with this email already exists. Log in instead.", fields };

  const [user] = await db
    .insert(schema.users)
    .values({
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: await bcrypt.hash(parsed.data.password, 12),
    })
    .returning({ id: schema.users.id });
  await createSession(user!.id);
  redirect("/settings/api?welcome=1");
}

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = "$2b$12$V60G5Hw4DDjART3A6b4fZuHXY01ZJxd2mcPLwjZFyjLnNZG6EHROy";

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", fields: { email } };

  const db = await getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .limit(1);
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return { error: "That email and password don't match.", fields: { email } };

  await createSession(user.id);
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
