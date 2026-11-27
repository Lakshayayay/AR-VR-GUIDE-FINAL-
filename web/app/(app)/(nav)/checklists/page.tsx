"use client";

import { ClipboardCheck, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Button, Empty, ErrorText, Field, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import type { Checklist } from "@/lib/types";

const BLANK = { id: 0, name: "", description: "", steps: [], active: true } satisfies Checklist;

// One step per line; a line starting with "!" is a critical step.
const toText = (c: Checklist) => c.steps.map((s) => `${s.critical ? "! " : ""}${s.text}`).join("\n");
const toSteps = (text: string) =>
  text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => ({ critical: l.startsWith("!"), text: l.replace(/^!\s*/, "") }));

export default function ChecklistsPage() {
  const { toast } = useApp();
  const [list, setList] = useState<Checklist[] | null>(null);
  const [listError, setListError] = useState("");
  const [editing, setEditing] = useState<Checklist | null>(null);
  const [stepsText, setStepsText] = useState("");
  const [error, setError] = useState("");
  const editor = useRef<HTMLFormElement>(null);

  const load = () => api<Checklist[]>("/checklists?include_hidden=true").then((items) => {
    setList(items);
    setListError("");
  }, (e) => setListError(e.message));
  useEffect(() => void load(), []);

  const open = (c: Checklist) => {
    setEditing(c);
    setStepsText(toText(c));
    setError("");
    requestAnimationFrame(() => editor.current?.focus());
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const body = { name: editing.name, description: editing.description, active: editing.active, steps: toSteps(stepsText) };
    try {
      const saved = await api<Checklist>(editing.id ? `/checklists/${editing.id}` : "/checklists", { method: editing.id ? "PUT" : "POST", json: body });
      toast(`Saved “${saved.name}”.`);
      setEditing(saved);
      setStepsText(toText(saved));
      setError("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  };

  return (
    <main className="mx-auto grid max-w-5xl items-start gap-8 px-4 py-8 md:grid-cols-[19rem_minmax(0,1fr)]">
      <section aria-labelledby="lists">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="lists" className="text-2xl font-bold">Checklists</h1>
          <Button onClick={() => open(BLANK)}><Plus aria-hidden className="size-4" /> New checklist</Button>
        </div>
        <div className="mt-4">
          {listError ? <ErrorText>{listError}</ErrorText> : list === null ? (
            <p role="status" className="text-ink-soft">Loading checklists…</p>
          ) : list.length === 0 ? (
            <Empty icon={ClipboardCheck} title="No checklists yet">Create a checklist to guide a technician through a call.</Empty>
          ) : (
            <ul className="space-y-2">
              {list.map((c) => {
                const critical = c.steps.filter((s) => s.critical).length;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => open(c)}
                      aria-current={editing?.id === c.id ? "true" : undefined}
                      className={`flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-3 text-left ${editing?.id === c.id ? "border-blue bg-blue/5" : "border-rule bg-card hover:border-blue"}`}
                    >
                      <ClipboardCheck aria-hidden className="size-5 shrink-0 text-blue" />
                      <span className="min-w-0">
                        <span className="block wrap-anywhere font-bold">{c.name}</span>
                        <span className="mt-1 block text-sm text-ink-soft tabular-nums">
                          {c.steps.length} {c.steps.length === 1 ? "step" : "steps"}, {critical} critical{c.active ? "" : ", hidden"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {editing ? (
        <form ref={editor} tabIndex={-1} onSubmit={save} className="space-y-5 rounded-xl border border-rule bg-card p-4 sm:p-6" aria-labelledby="checklist-editor">
          <h2 id="checklist-editor" className="text-lg font-bold">{editing.id ? "Edit checklist" : "New checklist"}</h2>
          <Field label="Name">
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required maxLength={120} />
          </Field>
          <Field label="What it is for">
            <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={500} />
          </Field>
          <Field label="Steps" hint="One step per line. Start a line with ! to mark a critical step. Changes apply to new calls only; past reports keep their steps.">
            <Textarea value={stepsText} onChange={(e) => setStepsText(e.target.value)} rows={12} required />
          </Field>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="size-5" />
            Technicians can choose this checklist
          </label>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" variant="primary">{editing.id ? "Save changes" : "Create checklist"}</Button>
        </form>
      ) : !!list?.length && (
        <div className="hidden md:block"><Empty icon={ClipboardCheck} title="Choose a checklist">Select a checklist to edit its steps.</Empty></div>
      )}
    </main>
  );
}
