import { open, type OpenDialogOptions } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

type TestWindow = {
  __SANCTUARYFLOW_E2E__?: boolean;
  __sanctuaryflowPickFile?: () => string | null;
  __sanctuaryflowPickFolder?: () => string | null;
  __sanctuaryflowOpenUrl?: (url: string) => void;
};

const testing = (w: TestWindow) => import.meta.env.DEV || w.__SANCTUARYFLOW_E2E__ === true;

/**
 * Asks the operator for one file. During end-to-end tests (development, or a
 * debug build started by the test harness) the tests answer through a hook
 * instead of the Windows file picker, which they cannot drive.
 */
export async function pickFile(options: Omit<OpenDialogOptions, "multiple" | "directory">): Promise<string | null> {
  const w = window as unknown as TestWindow;
  const hook = testing(w) ? w.__sanctuaryflowPickFile : undefined;
  if (hook) return hook();
  const path = await open({ ...options, multiple: false, directory: false });
  return typeof path === "string" ? path : null;
}

/** Asks the operator for a folder (answered by a hook during end-to-end tests, like {@link pickFile}). */
export async function pickFolder(options: Omit<OpenDialogOptions, "multiple" | "directory">): Promise<string | null> {
  const w = window as unknown as TestWindow;
  const hook = testing(w) ? w.__sanctuaryflowPickFolder : undefined;
  if (hook) return hook();
  const path = await open({ ...options, multiple: false, directory: true });
  return typeof path === "string" ? path : null;
}

/** Opens a web page in the operator's browser (the tests watch instead of opening one). */
export async function openExternal(url: string): Promise<void> {
  const w = window as unknown as TestWindow;
  const hook = testing(w) ? w.__sanctuaryflowOpenUrl : undefined;
  if (hook) return hook(url);
  await openUrl(url);
}
