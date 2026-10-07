"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { WarningCircle, X } from "@phosphor-icons/react";

// Native <dialog>: focus trap, Escape and backdrop come from the browser.
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  variant = "modal",
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: "modal" | "sheet";
  wide?: boolean; // sheet only: room for a grid such as invoice lines
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const shape =
    variant === "sheet"
      ? `sheet m-0 ml-auto h-dvh max-h-dvh w-full ${wide ? "max-w-[1120px]" : "max-w-[560px]"} border-l`
      : "modal m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border";

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`${shape} border-line bg-surface p-0 text-ink shadow-[0_24px_64px_rgb(28_25_23/0.18)] backdrop:bg-stone-950/30`}
    >
      <div className={`flex flex-col ${variant === "sheet" ? "h-full" : ""}`}>
        <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 inline-flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-subtle hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className={`px-6 py-5 ${variant === "sheet" ? "flex-1 overflow-y-auto" : ""}`}>{children}</div>
        {footer && <div className="flex gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </dialog>
  );
}

// "Are you sure?" for destructive actions. Shows the server's error in place if it refuses.
export function Confirm({
  title,
  children,
  action = "Delete",
  tone = "danger",
  onConfirm,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  action?: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button
            className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50 ${tone === "danger" ? "bg-bad text-white" : "bg-accent text-on-accent"}`}
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await onConfirm();
                if (r.ok) onClose();
                else setError(r.error ?? "Something went wrong.");
              })
            }
          >
            {busy ? "Working" : action}
          </button>
          <button className="inline-flex items-center justify-center rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="grid gap-4 text-sm text-ink-2">
        {error && <ErrorNote>{error}</ErrorNote>}
        {children}
      </div>
    </Dialog>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex gap-2.5 rounded-lg bg-bad-soft px-3.5 py-3 text-sm text-bad">
      <WarningCircle size={18} weight="fill" className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}
