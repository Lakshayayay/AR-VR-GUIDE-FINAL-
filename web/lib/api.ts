import type { Role } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// No sign-in for now: each tab remembers which person it acts as, so two tabs can be two people.
// Set by the pick-a-person screen, or by opening a page with ?as=<username>. Google sign-in replaces this.
const PERSON_KEY = "arguide.person";
export function choosePerson(username: string | null) {
  try {
    if (username) sessionStorage.setItem(PERSON_KEY, username);
    else sessionStorage.removeItem(PERSON_KEY);
  } catch {}
}
export function personFromAddress() {
  const as = new URLSearchParams(window.location.search).get("as");
  if (as) choosePerson(as);
}
export function person(): string | null {
  try {
    return sessionStorage.getItem(PERSON_KEY);
  } catch {
    return null;
  }
}

/** Calls the Python server through Next.js (same address). */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const who = typeof window !== "undefined" ? person() : null;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: {
      ...(json === undefined ? {} : { "content-type": "application/json" }),
      ...(who ? { "x-arguide-user": who } : {}),
      ...(rest.headers as Record<string, string> | undefined),
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") window.location.assign("/login");
    throw new ApiError(res.status, await errorMessage(res));
  }
  return res.json() as Promise<T>;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]) {
      const { loc, msg } = body.detail[0];
      return `${String(loc?.at(-1) ?? "Input")}: ${msg}`;
    }
  } catch {}
  return res.status >= 500 ? "The server had a problem. Try again in a moment." : "That did not work. Try again.";
}

export const homeFor = (role: Role) => (role === "technician" ? "/tech" : "/expert");

// Pictures and videos cannot send a header, so the person goes in the address.
export const fileUrl = (eventId: number) => `/api/files/${eventId}?user=${encodeURIComponent(person() ?? "")}`;
