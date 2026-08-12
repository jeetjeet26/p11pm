import { exportCommercialReportCsv } from "@/lib/commercial-reports";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reportKind = url.searchParams.get("kind") === "delivery" ? "delivery" : "operations";
  const days = Number(url.searchParams.get("days") ?? "90");
  const projectId = url.searchParams.get("project") ?? undefined;
  const payload = await exportCommercialReportCsv({
    reportKind,
    days: Number.isFinite(days) ? days : 90,
    projectId,
  });
  if (!payload) {
    return Response.json({ error: "Report export unavailable." }, { status: 503 });
  }
  const filename = String(payload.filename ?? "report.csv");
  const csv = String(payload.csv ?? "");
  return new Response(csv, {
    headers: {
      "Content-Type": String(payload.contentType ?? "text/csv; charset=utf-8"),
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
