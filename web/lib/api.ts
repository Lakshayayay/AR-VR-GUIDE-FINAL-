import type { Role } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Local testing without passwords (server started with DEV_NO_LOGIN=true): open a page with
// ?as=<username> and this tab acts as that person. Kept per tab, so two tabs can be two people.
const DEV_KEY = "arguide.devUser";
export function rememberDevUser() {
  try {
    const as = new URLSearchParams(window.location.search).get("as");
    if (as) sessionStorage.setItem(DEV_KEY, as);
  } catch {}
}
function devUser(): string | null {
  try {
    return sessionStorage.getItem(DEV_KEY);
  } catch {
    return null;
  }
}

/** Calls the Python server through Next.js (same address, so the sign-in cookie is sent). */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const dev = typeof window !== "undefined" ? devUser() : null;
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: {
      ...(json === undefined ? {} : { "content-type": "application/json" }),
      ...(dev ? { "x-dev-user": dev } : {}),
      ...(rest.headers as Record<string, string> | undefined),
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/login" && typeof window !== "undefined") {
      window.location.assign("/login");
    }
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

export const fileUrl = (eventId: number) => `/api/files/${eventId}`;
