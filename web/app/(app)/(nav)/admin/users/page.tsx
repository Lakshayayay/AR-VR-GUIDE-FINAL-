"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Button, ErrorText, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";

const ROLES: [Role, string][] = [["technician", "Technician"], ["expert", "Expert"], ["admin", "Admin"]];

export default function PeoplePage() {
  const { me, toast } = useApp();
  const [people, setPeople] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [resetFor, setResetFor] = useState<number | null>(null);

  const load = () => api<User[]>("/users").then(setPeople, (e) => setError(e.message));
  useEffect(() => void load(), []);

  const change = async (u: User, patch: Partial<User> & { password?: string }, done: string) => {
    try {
      await api(`/users/${u.id}`, { method: "PATCH", json: patch });
      toast(done);
      await load();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save.");
      return false;
    }
  };

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      await api("/users", { method: "POST", json: { ...data, username: String(data.username).trim().toLowerCase() } });
      toast(`Added ${data.name}. Give them their username and password.`);
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
      <div className="mt-4 overflow-x-auto rounded-lg border border-rule bg-card">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="border-b border-rule text-ink-soft">
            <tr>
              {["Name", "Username", "Role", "Access", "Password"].map((h) => <th key={h} scope="col" className="px-4 py-3 font-bold">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {people.map((u) => (
              <tr key={u.id} className={u.active ? "" : "text-ink-soft"}>
                <td className="px-4 py-3 font-bold">{u.name}</td>
                <td className="px-4 py-3 font-mono">{u.username}</td>
                <td className="px-4 py-3">
                  <Select aria-label={`Role of ${u.name}`} value={u.role} disabled={u.id === me.id} onChange={(e) => change(u, { role: e.target.value as Role }, `${u.name} is now ${e.target.value}.`)} className="w-36">
                    {ROLES.map(([r, label]) => <option key={r} value={r}>{label}</option>)}
                  </Select>
                </td>
                <td className="px-4 py-3">
                  {u.id === me.id ? "You" : (
                    <Button onClick={() => change(u, { active: !u.active }, u.active ? `${u.name} can no longer sign in.` : `${u.name} can sign in again.`)}>
                      {u.active ? "Remove access" : "Restore access"}
                    </Button>
                  )}
                </td>
                <td className="px-4 py-3">
                  {resetFor === u.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const password = String(new FormData(e.currentTarget).get("password"));
                        if (await change(u, { password }, `New password set for ${u.name}.`)) setResetFor(null);
                      }}
                    >
                      <Input name="password" type="text" minLength={8} required autoFocus aria-label={`New password for ${u.name}`} placeholder="8+ characters" className="w-40" />
                      <Button type="submit" variant="primary">Set</Button>
                    </form>
                  ) : (
                    <Button onClick={() => setResetFor(u.id)}>Set new password</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} className="mt-10 max-w-xl space-y-4" aria-labelledby="add">
        <h2 id="add" className="text-lg font-bold">Add a person</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name"><Input name="name" required maxLength={120} /></Field>
          <Field label="Username" hint="Lower-case letters, numbers, dot, dash."><Input name="username" required pattern="[a-zA-Z0-9._\-]{2,64}" autoCapitalize="none" /></Field>
          <Field label="Role">
            <Select name="role" defaultValue="technician">
              {ROLES.map(([r, label]) => <option key={r} value={r}>{label}</option>)}
            </Select>
          </Field>
          <Field label="First password" hint="At least 8 characters."><Input name="password" type="text" minLength={8} required /></Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary">Add person</Button>
      </form>
    </main>
  );
}
