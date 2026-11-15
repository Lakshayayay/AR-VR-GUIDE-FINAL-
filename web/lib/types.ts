export type Role = "technician" | "expert" | "admin";

export interface User {
  id: number;
  username: string;
  name: string;
  role: Role;
  active: boolean;
}

export interface Person {
  id: number;
  name: string;
}

export interface ChecklistStep {
  text: string;
  critical: boolean;
}

export interface Checklist {
  id: number;
  name: string;
  description: string;
  steps: ChecklistStep[];
  active: boolean;
}

export type SessionStatus = "waiting" | "active" | "ended" | "missed" | "cancelled";

export interface Session {
  id: number;
  code: string;
  aircraft: string;
  status: SessionStatus;
  technician: Person;
  expert: Person | null;
  checklist: { id: number | null; name: string; steps: ChecklistStep[] } | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  annotationCount: number;
  signedOff: SignOff | null;
}

export interface SignOff {
  by: string;
  at: string;
}

export interface StepResult {
  step: number;
  status: "done" | "problem";
  note: string;
  user: Person;
  at: string;
}

export interface SessionEvent {
  id: number;
  kind: "chat" | "note" | "photo" | "recording";
  text: string;
  hasFile: boolean;
  user: Person | null;
  at: string;
}

export interface SessionDetail extends Session {
  steps: StepResult[];
  events: SessionEvent[];
}

export interface Stats {
  days: number;
  calls: number;
  answered: number;
  missed: number;
  signedOff: number;
  averageMinutes: number | null;
  averageWaitSeconds: number | null;
}
