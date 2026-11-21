"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Button, ErrorText, Field, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import type { Checklist } from "@/lib/types";

const BLANK = { id: 0, name: "", description: "", steps: [], active: true } satisfies Checklist;

// One step per line; a line starting with "!" is a critical step.
const toText = (c: Checklist) => c.steps.map((s) => `${s.critical ? "! " : ""}${s.text}`).join("\n");
const toSteps = (text: string) =>
  text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => ({ critical: l.startsWith("!"), text: l.replace(/^!\s*/, "") }));

export default function ChecklistsPage() {
  const { toast } = useApp();
  const [list, setList] = useState<Checklist[]>([]);
  const [editing, setEditing] = useState<Checklist | null>(null);
  const [stepsText, setStepsText] = useState("");
  const [error, setError] = useState("");

  const load = () => api<Checklist[]>("/checklists?include_hidden=true").then(setList, () => {});
  useEffect(() => void load(), []);

  const open = (c: Checklist) => {
    setEditing(c);
    setStepsText(toText(c));
    setError("");
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const body = { name: editing.name, description: editing.description, active: editing.active, steps: toSteps(stepsText) };
    try {
      const saved = await api<Checklist>(editing.id ? `/checklists/${editing.id}` : "/checklists", { method: editing.id ? "PUT" : "POST", json: body });
      toast(`Saved “${saved.name}”.`);
      open(saved);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  };

  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[16rem_1fr]">
      <section aria-labelledby="lists">
        <h1 id="lists" className="text-2xl font-bold">Checklists</h1>
        <ul className="mt-4 space-y-1">
          {list.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => open(c)}
                aria-current={editing?.id === c.id}
                className={`w-full rounded-md px-3 py-2 text-left ${editing?.id === c.id ? "bg-ink text-white" : "hover:bg-card"}`}
              >
                {c.name}
                <span className="block text-sm opacity-75">{c.steps.length} steps{c.active ? "" : ", hidden"}</span>
              </button>
            </li>
          ))}
        </ul>
        <Button className="mt-4 w-full" onClick={() => open(BLANK)}>New checklist</Button>
      </section>

      {editing ? (
        <form onSubmit={save} className="space-y-5" aria-label="Edit checklist">
          <Field label="Name">
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required maxLength={120} />
          </Field>
          <Field label="What it is for">
            <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={500} />
          </Field>
          <Field label="Steps" hint="One step per line. Start a line with ! to mark a critical step. Changes apply to new calls only; past reports keep their steps.">
            <Textarea value={stepsText} onChange={(e) => setStepsText(e.target.value)} rows={12} required className="font-mono text-sm" />
          </Field>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="size-5" />
            Technicians can choose this checklist
          </label>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" variant="primary">{editing.id ? "Save changes" : "Create checklist"}</Button>
        </form>
      ) : (
        <p className="self-center text-ink-soft">Choose a checklist to edit, or make a new one.</p>
      )}
    </main>
  );
}
