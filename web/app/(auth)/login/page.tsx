"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorText } from "@/components/ui";
import { api, choosePerson, homeFor } from "@/lib/api";
import type { User } from "@/lib/types";

// Stands where sign-in will be: Google sign-in replaces this list.
export default function ChoosePersonPage() {
  const router = useRouter();
  const [people, setPeople] = useState<User[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<User[]>("/auth/people").then(setPeople, (e) => setError(e.message));
  }, []);

  const open = (user: User) => {
    choosePerson(user.username);
    router.replace(homeFor(user.role));
  };

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl content-center gap-12 px-4 py-12 md:grid-cols-[1.2fr_1fr] md:px-8">
      <div>
        <p className="text-5xl font-bold tracking-tight md:text-6xl">ArGuide</p>
        <p className="mt-4 max-w-sm text-lg text-ink-soft">
          Live help on the flight line. The technician points a camera, the expert sees it and marks it up.
        </p>
      </div>
      <section className="space-y-3 md:border-l md:border-rule md:pl-12" aria-labelledby="who">
        <h1 id="who" className="text-xl font-bold">
          Who are you?
        </h1>
        {people?.map((u) => (
          <Button key={u.id} size="lg" className="w-full" onClick={() => open(u)}>
            {u.name} · <span className="capitalize">{u.role}</span>
          </Button>
        ))}
        {people?.length === 0 && (
          <p className="text-ink-soft">
            No people yet. Add the first admin: <code className="font-mono text-sm">uv run python -m app.cli create-user admin &quot;Your Name&quot; admin</code>
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <p className="text-sm text-ink-soft">No password for now. Sign-in comes later.</p>
      </section>
    </main>
  );
}
