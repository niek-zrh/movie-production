/** Container healthcheck target (Dockerfile HEALTHCHECK hits this). */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, service: "kinolab" });
}
