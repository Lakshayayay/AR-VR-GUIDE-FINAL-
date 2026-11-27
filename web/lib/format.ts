import { useEffect, useState } from "react";
import type { SessionStatus } from "./types";

/** The current time, updated every second (for timers). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export const since = (iso: string | null | undefined, now: number) => (iso ? (now - Date.parse(iso)) / 1000 : 0);

/** 754 -> "12:34" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

const todayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
/** "Saturday 28 November" */
export const today = (now: number) => todayFmt.format(now);

export const day = (iso: string) => dateFmt.format(new Date(iso));
export const time = (iso: string) => timeFmt.format(new Date(iso));
export const dateTime = (iso: string) => `${day(iso)}, ${time(iso)}`;

export function minutes(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  const m = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  return m < 1 ? "under 1 min" : `${m} min`;
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  waiting: "Ringing",
  active: "In progress",
  ended: "Completed",
  missed: "Not answered",
  cancelled: "Cancelled",
};
