import { apiUrl } from "../lib/config";
import { fetchJson } from "../lib/http";
import { tr } from "../i18n";
import { app } from "../stores/app";
import type { BroadcastLogRow } from "../types/broadcast-log";

export async function loadBroadcastLog(): Promise<void> {
  try {
    const data = await fetchJson<{ rows: BroadcastLogRow[] }>(`${apiUrl}/api/admin/analytics/broadcast-log`);
    app.update((s) => ({ ...s, broadcastLogRows: data.rows ?? [], broadcastLogStatus: "" }));
  } catch (error) {
    app.update((s) => ({ ...s, broadcastLogStatus: tr("status.error_prefix", { message: (error as Error).message }) }));
  }
}
