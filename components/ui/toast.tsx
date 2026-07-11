"use client";

import type { ReactNode } from "react";
import { create } from "zustand";
import { cn } from "@/lib/cn";

export interface ToastOptions {
  msg: ReactNode;
  /** Shows a lime "Undo" pill; caller supplies the reverse action (prototype: stock take-out/add-in). */
  undo?: boolean;
  onUndo?: () => void;
  /** Shows a quiet "×" close control — pair with a long/zero timeout. */
  dismissable?: boolean;
  onDismiss?: () => void;
  /** Auto-dismiss delay in ms. 0 disables the timer. Default: 5000 w/ undo, else 3200. */
  timeout?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (options) => {
    const id = Date.now() + Math.random();
    const timeout = options.timeout ?? (options.undo ? 5000 : 3200);
    set((s) => ({ toasts: [...s.toasts, { ...options, id }] }));
    if (timeout !== 0) {
      setTimeout(() => get().dismiss(id), timeout);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/**
 * Toast API — call from any client component:
 * `const { push } = useToast(); push({ msg: "Took out 4 × SMK-000101", undo: true, onUndo: () => ... })`.
 * Mount a single `<ToastViewport />` near the app root to render the stack.
 */
export function useToast() {
  const push = useToastStore((s) => s.push);
  const dismiss = useToastStore((s) => s.dismiss);
  const clear = useToastStore((s) => s.clear);
  return { push, dismiss, clear };
}

export interface ToastViewportProps {
  /** Distance from the viewport bottom edge, in px — raise to clear a mobile tab bar (prototype: 28 desktop / 76 mobile). */
  bottomOffset?: number;
  className?: string;
}

/**
 * Fixed bottom-center toast stack (white pill, 1px hairline border, elevated,
 * lime Undo pill). Newest toast renders closest to the anchor
 * edge; older ones stack upward. Mount once, e.g. in the app shell layout.
 */
export function ToastViewport({
  bottomOffset = 28,
  className,
}: ToastViewportProps) {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{ bottom: bottomOffset }}
      className={cn(
        "pointer-events-none fixed left-1/2 z-[80] flex -translate-x-1/2 flex-col-reverse items-center gap-3",
        className,
      )}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="animate-toast-in pointer-events-auto flex max-w-[92vw] items-center gap-4 rounded-full border border-slate bg-surface py-[11px] pr-3 pl-5 shadow-sm"
        >
          <span className="truncate text-[13px] text-snow">{t.msg}</span>
          {t.undo && (
            <button
              type="button"
              onClick={() => {
                t.onUndo?.();
                dismiss(t.id);
              }}
              className="flex-none cursor-pointer rounded-full bg-lime px-4 py-1.5 text-[13px] font-medium text-obsidian hover:bg-lime-hover"
            >
              Undo
            </button>
          )}
          {t.dismissable && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                t.onDismiss?.();
                dismiss(t.id);
              }}
              className="flex-none cursor-pointer bg-transparent px-1.5 text-base text-smoke hover:text-snow"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
