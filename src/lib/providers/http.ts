import "server-only";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** fetch + JSON with a timeout; non-2xx responses become ProviderError with the provider's message. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (err) {
    throw new ProviderError(`Could not reach ${new URL(url).host}: ${(err as Error).message}`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const b = body as Record<string, any>;
    // Google: { error, error_description } or { error: { message } }. Meta: { error: { message, code } }.
    const message =
      b?.error_description ??
      (typeof b?.error === "object" ? b.error.message : undefined) ??
      (typeof b?.error === "string" ? b.error : undefined) ??
      `HTTP ${res.status}`;
    const code = typeof b?.error === "string" ? b.error : b?.error?.code?.toString() ?? b?.error?.status;
    throw new ProviderError(message, res.status, code);
  }
  return body as T;
}
