import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { create } from "zustand";
import { errorMessage } from "@/lib/ipc";
import { cn } from "@/lib/cn";

type Kind = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  kind: Kind;
  title: string;
  detail?: string;
}

const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, "id">) => void; dismiss: (id: number) => void }>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === "error" ? 9000 : 4500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (title: string, detail?: string) => useToasts.getState().push({ kind: "success", title, ...(detail ? { detail } : {}) }),
  info: (title: string, detail?: string) => useToasts.getState().push({ kind: "info", title, ...(detail ? { detail } : {}) }),
  warning: (title: string, detail?: string) => useToasts.getState().push({ kind: "warning", title, ...(detail ? { detail } : {}) }),
  error: (title: string, error?: unknown) =>
    useToasts.getState().push({ kind: "error", title, ...(error !== undefined ? { detail: errorMessage(error) } : {}) }),
};

const icons = {
  success: <CheckCircle2 className="size-4 text-success" />,
  error: <XCircle className="size-4 text-danger" />,
  info: <Info className="size-4 text-primary" />,
  warning: <AlertTriangle className="size-4 text-warning" />,
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-[60] flex w-96 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-lg border bg-elevated px-3 py-2.5 shadow-xl",
            t.kind === "error" ? "border-danger/60" : "border-border",
          )}
        >
          <div className="mt-0.5">{icons[t.kind]}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">{t.title}</p>
            {t.detail && <p className="mt-0.5 text-xs break-words text-muted selectable">{t.detail}</p>}
          </div>
          <button type="button" aria-label="Dismiss" className="text-subtle hover:text-text" onClick={() => dismiss(t.id)}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
