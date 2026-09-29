import { serveExport } from "@/lib/export-route";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return serveExport(request, "pdf");
}
