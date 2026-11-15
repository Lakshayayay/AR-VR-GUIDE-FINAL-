"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { api, homeFor } from "@/lib/api";
import type { User } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const user = await api<User>("/auth/login", {
        method: "POST",
        json: { username: form.get("username"), password: form.get("password") },
      });
      router.replace(homeFor(user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl content-center gap-12 px-4 py-12 md:grid-cols-[1.2fr_1fr] md:px-8">
      <div>
        <p className="text-5xl font-bold tracking-tight md:text-6xl">ArGuide</p>
        <p className="mt-4 max-w-sm text-lg text-ink-soft">
          Live help on the flight line. The technician points a camera, the expert sees it and marks it up.
        </p>
      </div>
      {/* method="post": if the page's script has not loaded yet, the password must never go into the address bar. */}
      <form method="post" onSubmit={submit} className="space-y-5 md:border-l md:border-rule md:pl-12" aria-labelledby="signin">
        <h1 id="signin" className="text-xl font-bold">
          Sign in
        </h1>
        <Field label="Username">
          <Input name="username" autoComplete="username" autoCapitalize="none" required autoFocus />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-sm text-ink-soft">No account? Ask your ArGuide admin to add you.</p>
      </form>
    </main>
  );
}
