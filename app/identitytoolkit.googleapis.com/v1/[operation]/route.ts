import { relayAuth } from "@/lib/demo-auth-relay";
const allowed = new Set([
  "accounts:signUp",
  "accounts:signInWithPassword",
  "accounts:signInWithIdp",
  "accounts:signInWithCustomToken",
  "accounts:lookup",
]);
export async function POST(
  request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (!allowed.has(operation)) return new Response(null, { status: 404 });
  return relayAuth(request, `/identitytoolkit.googleapis.com/v1/${operation}`);
}
export async function GET(
  request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  return operation === "projects"
    ? relayAuth(request, "/identitytoolkit.googleapis.com/v1/projects")
    : new Response(null, { status: 404 });
}
