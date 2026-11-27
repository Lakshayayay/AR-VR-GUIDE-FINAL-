"use client";

import { ChevronRight, ClipboardCheck, PenLine, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Button, ErrorText, Field, Input, Mark } from "@/components/ui";
import { api, ApiError, choosePerson, homeFor } from "@/lib/api";
import type { User } from "@/lib/types";

const DOES = [
  [Video, "Point the camera at the job and an expert sees it live."],
  [PenLine, "Drawings stay on the part, even when the camera moves."],
  [ClipboardCheck, "Work through the checklist and have it signed off."],
] as const;

// Stands where sign-in will be: Google sign-in replaces this list.
export default function ChoosePersonPage() {
  const router = useRouter();
  const [people, setPeople] = useState<User[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<User[]>("/auth/people").then(setPeople, (e) => setError(e.message));
  }, []);

  const open = (user: User) => {
    choosePerson(user.username);
    router.replace(homeFor(user.role));
  };

  const setUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      open(await api<User>("/auth/setup", { method: "POST", json: { name: new FormData(e.currentTarget).get("name") } }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await api<User[]>("/auth/people").then(setPeople, () => {});
      }
      setError(err instanceof Error ? err.message : "Could not set up ArGuide.");
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh content-start md:grid-cols-2 md:content-stretch">
      <div className="live flex flex-col justify-center px-6 py-10 md:px-12 lg:px-20">
        <p className="flex items-center gap-3 text-2xl font-bold tracking-tight">
          <Mark className="size-12" />
          ArGuide
        </p>
        <p className="mt-6 max-w-md text-3xl font-bold leading-tight md:text-5xl md:leading-tight">Live help on the flight line.</p>
        <ul className="mt-8 hidden max-w-md space-y-4 sm:block">
          {DOES.map(([Icon, text]) => (
            <li key={text} className="flex items-start gap-3 text-dim">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-panel text-blue-bright">
                <Icon aria-hidden className="size-5" />
              </span>
              <span className="pt-2">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <section className="flex flex-col justify-center px-6 py-10 md:px-12 lg:px-20" aria-labelledby={people ? "who" : undefined}>
        <div className="w-full max-w-md">
          {people === null ? (
            !error && <p id="who" role="status" className="text-ink-soft">Loading…</p>
          ) : people.length === 0 ? (
            <form onSubmit={setUp} className="space-y-4">
              <h1 id="who" className="text-2xl font-bold">Set up ArGuide</h1>
              <p className="text-ink-soft">You are the first person here, so you will be the admin. Next, add your technicians and experts.</p>
              <Field label="Your name">
                <Input name="name" required maxLength={120} autoComplete="name" autoFocus className="min-h-14 text-lg" />
              </Field>
              <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
                {busy ? "Setting up…" : "Create admin account"}
              </Button>
            </form>
          ) : (
            <>
              <h1 id="who" className="text-2xl font-bold">Who are you?</h1>
              <ul className="mt-5 space-y-3">
                {people.map((u) => (
                  <li key={u.id}>
                    <button
                      onClick={() => open(u)}
                      className="flex min-h-16 w-full items-center gap-4 rounded-xl border border-rule bg-card px-4 py-3 text-left transition-colors hover:border-blue hover:bg-blue/5"
                    >
                      <Avatar name={u.name} className="size-11" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{u.name}</span>
                        <span className="block text-sm capitalize text-ink-soft">{u.role}</span>
                      </span>
                      <ChevronRight aria-hidden className="size-5 text-ink-soft" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-3"><ErrorText>{error}</ErrorText></div>
        </div>
      </section>
    </main>
  );
}
