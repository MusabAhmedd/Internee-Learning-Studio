import { relayAuth } from "@/lib/demo-auth-relay";
export async function GET(
  request: Request,
  context: { params: Promise<{ page: string }> },
) {
  const { page } = await context.params;
  return page === "handler" || page === "iframe"
    ? relayAuth(request, `/emulator/auth/${page}`)
    : new Response(null, { status: 404 });
}
