import type { SessionState } from "@/lib/session";
import { exportSession } from "@/lib/session";
import { EXPORT_FILENAME } from "@/lib/workspace";

/** Hands the browser a file to save. Nothing leaves the browser. */
export function saveFile(text: string, type: string, filename: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Saves the whole session as the JSON file the drawer's Import reads back.
 * Shared by the drawer's Export and the Start-over dialog (technical-plan.md D55).
 */
export function saveSessionExport(state: SessionState) {
  saveFile(exportSession(state), "application/json", EXPORT_FILENAME);
}
