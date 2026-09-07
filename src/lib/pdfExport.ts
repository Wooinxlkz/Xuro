import { ipc } from "@/lib/ipc";

/**
 * Export a note to PDF from its live rendered DOM (not a re-parse of the
 * markdown) — this is what makes math, tables, task lists, and images come
 * out looking exactly like the editor, with no separate PDF-rendering
 * pipeline to keep in sync with the editor's own rendering.
 *
 * The editor content is cloned into an off-screen, print-safe wrapper
 * (white background, fixed width, app theme stripped out) so the exported
 * PDF looks like a document regardless of whether the person is using
 * Xuro's dark theme.
 *
 * html2pdf.js (and the jsPDF/html2canvas it pulls in) is loaded on demand
 * here rather than imported at the top of the file — it's ~1MB and only
 * a fraction of sessions ever export a PDF, so it shouldn't cost every
 * app launch its load time.
 */
export async function exportNoteToPdf(
  contentEl: HTMLElement,
  rel: string,
  title: string,
): Promise<string | null> {
  const clone = contentEl.cloneNode(true) as HTMLElement;

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    position: fixed;
    top: 0;
    left: -10000px;
    width: 780px;
    background: #ffffff;
    color: #1a1a1a;
    padding: 48px 56px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.65;
  `;
  clone.classList.add("pdf-export-content");
  wrapper.appendChild(clone);

  const titleEl = document.createElement("h1");
  titleEl.textContent = title;
  titleEl.style.cssText =
    "font-size: 26px; font-weight: 700; margin: 0 0 20px; color: #111;";
  wrapper.insertBefore(titleEl, clone);

  document.body.appendChild(wrapper);

  try {
    const { default: html2pdf } = await import("html2pdf.js");
    const arrayBuffer = (await html2pdf()
      .set({
        margin: 0,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true },
        jsPDF: { unit: "pt", format: "a4", orientation: "portrait" },
      })
      .from(wrapper)
      .outputPdf("arraybuffer")) as ArrayBuffer;

    const base64 = arrayBufferToBase64(arrayBuffer);
    return await ipc.exportNotePdf(rel, base64);
  } finally {
    wrapper.remove();
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
