import { downloadResponse, exportFileName, loadExportData, NO_STORE_HEADERS, recordExport } from "./export";
import { renderPdf } from "./export-pdf";
import { ensureHouseholdFile } from "./household";
import { getSessionUser } from "./session";

/**
 * GET /app/export/{pdf,json}. Only the signed-in owner gets their own file
 * (the file is looked up from the session, never from the URL), every
 * response is no-store, and each download writes a content-free audit row.
 * /app/export/json?for=age is the browser-side encrypted export fetching its
 * plaintext; the passphrase never reaches the server.
 */
export async function serveExport(request: Request, kind: "pdf" | "json") {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Sign in to export your file.", {
      status: 401,
      headers: { ...NO_STORE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const file = await ensureHouseholdFile(user.id);
  const data = await loadExportData(file, new Date());
  if (kind === "pdf") {
    const pdf = await renderPdf(data);
    await recordExport(file.id, "pdf");
    return downloadResponse(pdf, "application/pdf", exportFileName(data.exportedAt, "pdf"));
  }
  const encrypted = new URL(request.url).searchParams.get("for") === "age";
  await recordExport(file.id, encrypted ? "json_age" : "json");
  return downloadResponse(
    `${JSON.stringify(data, null, 2)}\n`,
    "application/json; charset=utf-8",
    exportFileName(data.exportedAt, "json"),
  );
}
