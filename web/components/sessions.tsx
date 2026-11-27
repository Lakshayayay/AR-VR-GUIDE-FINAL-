import { BadgeCheck, ChevronRight, CircleCheck, CircleSlash, PhoneCall, PhoneMissed, Radio } from "lucide-react";
import Link from "next/link";
import { dateTime, minutes, STATUS_LABEL } from "@/lib/format";
import type { Session, SessionStatus } from "@/lib/types";
import { Avatar } from "./ui";

// Status colours are only used for status: green done, cyan live, amber ringing, red unanswered.
const LOOK: Record<SessionStatus, [typeof CircleCheck, string]> = {
  ended: [CircleCheck, "bg-normal/15 text-normal-ink"],
  active: [Radio, "bg-advisory/15 text-advisory-ink"],
  waiting: [PhoneCall, "bg-caution/15 text-caution-ink"],
  missed: [PhoneMissed, "bg-warn/15 text-warn-ink"],
  cancelled: [CircleSlash, "bg-ink-soft/10 text-ink-soft"],
};

const PILL = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold";

export function Pill({ icon: Icon, className, children }: { icon: typeof CircleCheck; className: string; children: React.ReactNode }) {
  return (
    <span className={`${PILL} ${className}`}>
      <Icon aria-hidden className="size-3.5" />
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: SessionStatus }) {
  const [icon, colours] = LOOK[status];
  return <Pill icon={icon} className={colours}>{STATUS_LABEL[status]}</Pill>;
}

export const SignedPill = () => <Pill icon={BadgeCheck} className="bg-blue/10 text-blue">Signed off</Pill>;

/** Past calls as rows that open their report. Shows the other person on each call. */
export function SessionList({ sessions, meId, details = false }: { sessions: Session[]; meId: number; details?: boolean }) {
  return (
    <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-card">
      {sessions.map((s) => {
        const other = s.technician.id === meId ? s.expert : s.technician;
        return (
          <li key={s.id}>
            <Link href={`/sessions/${s.id}`} className="block px-4 py-3 hover:bg-blue/5 focus-visible:outline-offset-[-3px]">
              <span className="flex min-h-10 items-center gap-3">
                {other && <Avatar name={other.name} />}
                <span className="min-w-0 flex-1">
                  {details ? (
                    <span className="block font-mono font-bold text-blue">{s.code}</span>
                  ) : (
                    <span className={`block truncate font-bold ${!s.checklist && s.aircraft ? "font-mono" : ""}`}>
                      {s.checklist?.name ?? (s.aircraft || "Call")}
                    </span>
                  )}
                  <span className={`block text-sm text-ink-soft tabular-nums ${details ? "" : "truncate"}`}>
                    {details ? dateTime(s.createdAt) : `${other?.name ?? "No expert"}, ${dateTime(s.createdAt)}`}
                  </span>
                </span>
                <StatusPill status={s.status} />
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-soft" />
              </span>
              {details && (
                <span className="mt-2 block space-y-1.5 text-sm">
                  <span className="block wrap-break-word font-bold">
                    {s.aircraft && <span className="font-mono">{s.aircraft}</span>}
                    {s.aircraft && s.checklist && " · "}
                    {s.checklist?.name ?? (!s.aircraft && "No aircraft or checklist")}
                  </span>
                  <span className="block wrap-break-word text-ink-soft">Technician: {s.technician.name}</span>
                  <span className="block wrap-break-word text-ink-soft">Expert: {s.expert?.name ?? "Unassigned"}</span>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    {s.startedAt && s.endedAt && <span className="text-ink-soft tabular-nums">{minutes(s.startedAt, s.endedAt)}</span>}
                    {s.signedOff && <SignedPill />}
                  </span>
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
