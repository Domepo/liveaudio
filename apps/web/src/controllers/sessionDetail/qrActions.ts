import { get } from "svelte/store";

import { tr } from "../../i18n";
import { app } from "../../stores/app";
import { generateJoin } from "./qr";

export function downloadQr(): void {
  const state = get(app);
  if (!state.joinQrDataUrl) return;
  const anchor = document.createElement("a");
  anchor.href = state.joinQrDataUrl;
  anchor.download = `join-${state.selectedSessionId || "session"}.png`;
  anchor.click();
}

export async function printQrCard(): Promise<void> {
  const printWindow = window.open("", "_blank", "width=900,height=1200");
  if (!printWindow) return;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><body style='font-family:Segoe UI,sans-serif;padding:24px'>${tr("status.qr_preparing")}</body></html>`);
  printWindow.document.close();

  const current = get(app);
  if (!current.joinQrDataUrl || !current.joinUrl) {
    await generateJoin(true);
  }
  const refreshed = get(app);
  if (!refreshed.joinQrDataUrl || !refreshed.joinUrl) {
    printWindow.document.open();
    printWindow.document.write(
      `<!doctype html><html><body style='font-family:Segoe UI,sans-serif;padding:24px'>${tr("status.qr_not_available")}</body></html>`
    );
    printWindow.document.close();
    return;
  }

  const title = refreshed.sessionName || tr("common.session");
  const tokenText = refreshed.sessionCode?.trim() || "------";
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>QR Print</title>
    <style>
      body { font-family: 'Avenir Next', 'Segoe UI', sans-serif; margin: 0; color: #0f172a; background: #fff; }
      .sheet { min-height: 100vh; display: grid; place-items: center; padding: 28px; }
      .layout { width: 100%; max-width: 860px; text-align: center; }
      h1 { margin: 0 0 18px; font-size: 52px; font-weight: 900; letter-spacing: -0.025em; }
      .qr { width: 430px; max-width: 86vw; display: block; margin: 0 auto; }
      .token { margin-top: 28px; font-size: 64px; font-weight: 900; letter-spacing: 0.12em; line-height: 1; }
      .url { margin-top: 16px; font-size: 28px; font-weight: 700; line-height: 1.35; word-break: break-all; }
      @media print { .sheet { padding: 0; } }
    </style>
  </head>
  <body>
    <main class="sheet">
      <section class="layout">
      <h1>${title.replace(/</g, "&lt;")}</h1>
      <img class="qr" src="${refreshed.joinQrDataUrl}" alt="${tr("common.qr_code")}" />
      <div class="token">${tokenText.replace(/</g, "&lt;")}</div>
      <div class="url">${refreshed.joinUrl.replace(/</g, "&lt;")}</div>
      </section>
    </main>
  </body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = () => {
    printWindow.print();
  };
}
