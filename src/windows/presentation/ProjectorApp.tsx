import { useCallback, useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { SlideRenderer } from "@/components/slide/SlideRenderer";
import { api } from "@/services/api";
import { DEFAULT_THEME } from "@/lib/theme";
import { isRenderState, type ProjectorMediaStatus, type ProjectorMusicStatus, type ProjectorRenderState } from "@/services/presentation-engine/render-model";

/**
 * The projector output. It renders only what the operator sends; there are
 * no controls, notes or chrome. If it reloads, it asks for the current state.
 */
export function ProjectorApp() {
  const [state, setState] = useState<ProjectorRenderState | null>(null);

  const apply = useCallback((v: unknown) => {
    if (!isRenderState(v)) return;
    setState((prev) => (prev && prev.seq > v.seq && v.seq !== 1 ? prev : v));
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisten = listen<unknown>("presentation://render", (e) => apply(e.payload));
    void api.presentation
      .getState()
      .then((s) => !disposed && apply(s))
      .catch(() => undefined);
    void api.presentation.report({ type: "ready", width: window.innerWidth, height: window.innerHeight }).catch(() => undefined);

    // Keys pressed while the output window has focus still control the show.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      emitTo("main", "projector://key", {
        code: e.code,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
      }).catch((err) => console.error("Could not forward a key to the operator window", err));
    };
    window.addEventListener("keydown", onKey);
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("contextmenu", block);
    return () => {
      disposed = true;
      void unlisten.then((u) => u());
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", block);
    };
  }, [apply]);

  const onMediaStatus = useCallback((s: ProjectorMediaStatus | ProjectorMusicStatus) => {
    void api.presentation.report(s).catch(() => undefined);
  }, []);

  return (
    <SlideRenderer
      className="relative h-screen w-screen overflow-hidden"
      content={state?.slide?.content ?? null}
      slideKey={state?.slide?.id ?? null}
      theme={state?.theme ?? DEFAULT_THEME}
      output={state?.output ?? "black"}
      media={state?.media ?? {}}
      logo={state?.logo ?? null}
      logoScreen={state?.logoScreen ?? null}
      music={state?.music ?? null}
      onMusicStatus={onMediaStatus}
      fadeMs={state?.fadeMs ?? 0}
      churchName={state?.churchName ?? ""}
      aspect={window.innerWidth / Math.max(1, window.innerHeight)}
      live
      mediaCommand={state?.mediaCommand ?? null}
      onMediaStatus={onMediaStatus}
    />
  );
}
