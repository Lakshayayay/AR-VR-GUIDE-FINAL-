"use client";

import { useEffect, useRef } from "react";

// Small building blocks on top of native HTML elements (no UI library needed).

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "danger" | "go";
  size?: "md" | "lg";
};

const VARIANTS = {
  primary: "bg-blue text-white hover:bg-[#124c86] border border-transparent",
  go: "bg-[#1f7a44] text-white hover:bg-[#18663a] border border-transparent", // darker than "normal" so white text passes 4.5:1
  danger: "bg-warn text-white hover:bg-[#a52219] border border-transparent",
  quiet: "border border-current/30 hover:bg-current/10",
};

export function Button({ variant = "quiet", size = "md", className = "", ...props }: ButtonProps) {
  const sizing = size === "lg" ? "min-h-14 px-6 text-base" : "min-h-10 px-4 text-sm";
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANTS[variant]} ${className}`}
    />
  );
}

const FIELD = "w-full min-h-10 rounded-md border border-rule bg-card px-3 text-base text-ink placeholder:text-ink-soft/70";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-ink-soft">{hint}</span>}
    </label>
  );
}

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`${FIELD} ${props.className ?? ""}`} />
);

export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={`${FIELD} ${props.className ?? ""}`} />
);

export const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={`${FIELD} py-2 ${props.className ?? ""}`} />
);

/** Native modal dialog: traps focus and closes on Escape by itself. */
export function Dialog({ open, onClose, label, className = "", children }: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-panel-line bg-panel p-6 text-white ${className}`}
    >
      {open && children}
    </dialog>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-rule px-6 py-10 text-center">
      <p className="font-bold">{title}</p>
      {children && <div className="mt-2 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return children ? (
    <p role="alert" className="text-sm font-bold text-warn">
      {children}
    </p>
  ) : null;
}
