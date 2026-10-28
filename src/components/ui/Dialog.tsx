import { useState, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { create } from "zustand";
import { Button } from "./Button";
import { cn } from "@/lib/cn";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissable = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  dismissable?: boolean;
}) {
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <D.Root open={open} onOpenChange={(o) => (dismissable || o ? onOpenChange(o) : undefined)}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <D.Content
          data-shortcuts="off"
          onEscapeKeyDown={(e) => !dismissable && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissable && e.preventDefault()}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "rounded-lg border border-border bg-panel shadow-2xl focus:outline-none",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <D.Title className="text-base font-semibold text-text">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</D.Description>
              )}
            </div>
            {dismissable && (
              <D.Close asChild>
                <button type="button" aria-label="Close" className="rounded p-1 text-muted hover:bg-elevated hover:text-text">
                  <X className="size-4" />
                </button>
              </D.Close>
            )}
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ request: ConfirmRequest | null; set: (r: ConfirmRequest | null) => void }>((set) => ({
  request: null,
  set: (request) => set({ request }),
}));

/** Asks for confirmation. Resolves true when the operator confirms. */
export function confirm(options: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().set({ ...options, resolve });
  });
}

export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const set = useConfirmStore((s) => s.set);
  const [busy, setBusy] = useState(false);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    set(null);
    setBusy(false);
  };
  return (
    <Dialog
      open={!!request}
      onOpenChange={(o) => !o && close(false)}
      title={request?.title ?? ""}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {request?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={request?.danger ? "danger" : "primary"}
            loading={busy}
            autoFocus
            onClick={() => {
              setBusy(true);
              close(true);
            }}
          >
            {request?.confirmLabel ?? "Continue"}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{request?.message}</div>
    </Dialog>
  );
}
