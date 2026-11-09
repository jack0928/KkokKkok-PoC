export const dynamic = "force-dynamic";

// Process liveness, not a claim that model credentials or model weights are ready.
export async function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
