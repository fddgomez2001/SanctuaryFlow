import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { normalizeUiTheme, type UiTheme } from "@/lib/uiTheme";
import { cn } from "@/lib/cn";

/** Light / Dark switch for the operator console, at the top of every page. High contrast stays in Settings. */
export function UiThemeToggle() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const theme = normalizeUiTheme(setting(settings.data, "general.uiTheme", "light"));
  const option = (value: UiTheme, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={theme === value}
      onClick={() => theme !== value && update.mutate({ "general.uiTheme": value })}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors",
        theme === value ? "bg-panel text-text shadow-sm ring-1 ring-border-strong" : "text-muted hover:text-text",
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Light or dark mode" className="flex rounded-md border border-border bg-elevated p-0.5">
      {option("light", "Light", <Sun className="size-3.5" />)}
      {option("dark", "Dark", <Moon className="size-3.5" />)}
    </div>
  );
}
