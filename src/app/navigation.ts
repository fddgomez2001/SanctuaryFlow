import { useEffect } from "react";
import { create } from "zustand";
import { confirm } from "@/components/ui/Dialog";

export type PageId =
  | "home"
  | "songs"
  | "bible"
  | "services"
  | "live"
  | "slides"
  | "media"
  | "themes"
  | "import-export"
  | "backup"
  | "sync"
  | "settings";

export type PageParams = Record<string, string | undefined>;

interface NavState {
  page: PageId;
  params: PageParams;
  /** Set by a page with unsaved edits; navigating away asks first. */
  guard: { message: string } | null;
  go: (page: PageId, params?: PageParams) => void;
  setGuard: (guard: { message: string } | null) => void;
}

export const useNav = create<NavState>((set) => ({
  page: "home",
  params: {},
  guard: null,
  go: (page, params = {}) => set({ page, params, guard: null }),
  setGuard: (guard) => set({ guard }),
}));

/** Navigates, asking first when the current page has unsaved changes. */
export async function navigate(page: PageId, params: PageParams = {}): Promise<boolean> {
  const { guard, go } = useNav.getState();
  if (guard) {
    const ok = await confirm({
      title: "Discard unsaved changes?",
      message: guard.message,
      confirmLabel: "Discard changes",
      danger: true,
    });
    if (!ok) return false;
  }
  go(page, params);
  return true;
}

/** Registers an unsaved-changes guard while `dirty` is true. */
export function useUnsavedGuard(dirty: boolean, message = "You have unsaved changes on this page.") {
  const setGuard = useNav((s) => s.setGuard);
  useEffect(() => {
    setGuard(dirty ? { message } : null);
    return () => setGuard(null);
  }, [dirty, message, setGuard]);
}
