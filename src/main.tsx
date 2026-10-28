import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./styles/global.css";
import { queryClient } from "@/app/queryClient";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { OperatorApp } from "@/windows/operator/OperatorApp";
import { applyUiTheme, rememberedUiTheme } from "@/lib/uiTheme";

applyUiTheme(rememberedUiTheme());

// The operator console is a desktop app: no browser context menu or zoom.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  if (!t?.closest("input, textarea, [contenteditable='true'], .selectable")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <OperatorApp />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
