import type { PassageRef } from "@/types/generated/PassageRef";
import type { ServiceItem } from "@/types/generated/ServiceItem";
import { toast } from "@/components/ui/Toast";
import { newId } from "@/lib/slides/deck";
import { errorMessage } from "@/lib/ipc";
import { useLive } from "./store";

async function send(item: ServiceItem) {
  try {
    await useLive.getState().present(item, true);
    const { projector, locked } = useLive.getState();
    if (!projector.open) toast.info(`“${item.title}” is ready on the Live page`, "The output is not live yet. Press Go Live on the Live page.");
    else if (locked) toast.info(`“${item.title}” is ready`, "The output is locked, so it was not shown. Press “Show it now” or unlock when it is time.");
    else toast.success(`Showing “${item.title}”`);
  } catch (e) {
    toast.error("Could not present that item", errorMessage(e));
  }
}

/** Presents a song immediately, without adding it to the saved service. */
export function presentSong(song: { id: string; title: string }) {
  return send({ id: newId(), itemType: "song", title: song.title, refId: song.id, settings: {}, notes: null });
}

/** Presents a Scripture passage immediately. */
export function presentScripture(translationId: string, references: PassageRef[], title: string) {
  return send({ id: newId(), itemType: "scripture", title, refId: null, settings: { translationId, references }, notes: null });
}

export function presentMedia(media: { id: string; title: string; kind: "image" | "video" | "audio" }) {
  if (media.kind === "audio") {
    toast.warning("Audio files cannot be shown on the projector.");
    return Promise.resolve();
  }
  return send({ id: newId(), itemType: media.kind, title: media.title, refId: media.id, settings: { fit: "contain", loop: false, muted: false }, notes: null });
}

export function presentDeck(deck: { id: string; title: string }) {
  return send({ id: newId(), itemType: "custom", title: deck.title, refId: deck.id, settings: {}, notes: null });
}
