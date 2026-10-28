import { invoke } from "@tauri-apps/api/core";

/** Error shape returned by every SanctuaryFlow command. */
export interface AppError {
  code: string;
  message: string;
}

export class CommandError extends Error implements AppError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CommandError";
  }
}

export function toAppError(e: unknown): CommandError {
  if (e instanceof CommandError) return e;
  if (e && typeof e === "object" && "message" in e) {
    const obj = e as { code?: unknown; message?: unknown };
    return new CommandError(typeof obj.code === "string" ? obj.code : "other", String(obj.message));
  }
  if (typeof e === "string") return new CommandError("other", e);
  return new CommandError("other", "Something went wrong.");
}

export function errorMessage(e: unknown): string {
  return toAppError(e).message;
}

/** True when running inside the Tauri shell (false in unit tests / plain browser). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Invokes a Rust command and normalizes failures into {@link CommandError}. */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw toAppError(e);
  }
}
