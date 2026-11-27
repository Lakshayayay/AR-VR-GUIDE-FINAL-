"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Avatar, Button, ErrorText, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";

const ROLES: [Role, string][] = [["technician", "Technician"], ["expert", "Expert"], ["admin", "Admin"]];

export default function PeoplePage() {
  const { me, toast } = useApp();
  const [people, setPeople] = useState<User[]>([]);
  const [error, setError] = useState("");

  const load = () => api<User[]>("/users").then(setPeople, (e) => setError(e.message));
  useEffect(() => void load(), []);

  const change = async (u: User, patch: Partial<User>, done: string) => {
    try {
      await api(`/users/${u.id}`, { method: "PATCH", json: patch });
      toast(done);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save.");
    }
  };

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      await api("/users", { method: "POST", json: { ...data, username: String(data.username).trim().toLowerCase() } });
      toast(`Added ${data.name}. They can now choose their name when opening ArGuide.`);
      form.reset();
      setError("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add.");
    }
  };

  if (me.role !== "admin") return <main className="p-8">Only admins can manage people.</main>;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">People</h1>
      {people.length > 0 && (
        <ul className="mt-5 divide-y divide-rule rounded-xl border border-rule bg-card text-sm">
          {people.map((u) => (
            <li key={u.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_9rem]">
              <div className={`col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1 ${u.active ? "" : "text-ink-soft"}`}>
                <Avatar name={u.name} />
                <div className="min-w-0 wrap-anywhere">
                  <p className="font-bold">{u.name}</p>
                  <p className="text-ink-soft">{u.username}{u.id === me.id && " (you)"}</p>
                </div>
              </div>
              <Select aria-label={`Role of ${u.name}`} value={u.role} disabled={u.id === me.id} onChange={(e) => change(u, { role: e.target.value as Role }, `${u.name} is now ${e.target.value}.`)}>
                {ROLES.map(([r, label]) => <option key={r} value={r}>{label}</option>)}
              </Select>
              {u.id !== me.id && (
                <Button onClick={() => change(u, { active: !u.active }, u.active ? `${u.name} can no longer use the app.` : `${u.name} can use the app again.`)}>
                  {u.active ? "Remove access" : "Restore access"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-10 max-w-xl space-y-4" aria-labelledby="add">
        <h2 id="add" className="text-lg font-bold">Add a person</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name"><Input name="name" required maxLength={120} /></Field>
          <Field label="Username" hint="2–64 letters, numbers, dots, dashes or underscores."><Input name="username" required pattern="[a-zA-Z0-9._\-]{2,64}" autoCapitalize="none" /></Field>
          <Field label="Role">
            <Select name="role" defaultValue="technician">
              {ROLES.map(([r, label]) => <option key={r} value={r}>{label}</option>)}
            </Select>
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary">Add person</Button>
      </form>
    </main>
  );
}
