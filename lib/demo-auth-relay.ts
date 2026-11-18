import { isDemo } from "./firebase-admin";

// The Auth emulator uses unsigned tokens. This relay is never available with a real project.
export async function relayAuth(request: Request, path: string) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (
    !isDemo() ||
    !process.env.FIREBASE_PROJECT_ID?.startsWith("demo-") ||
    !host ||
    !/^[a-z0-9.-]+:\d+$/i.test(host)
  )
    return new Response(null, { status: 404 });
  const url = new URL(request.url);
  if (url.search.length > 4096) return new Response(null, { status: 414 });
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (request.body) {
    const input = request.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await input.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) {
        void input.cancel().catch(() => {});
        return new Response(null, { status: 413 });
      }
      parts.push(value);
    }
    body = new Uint8Array(Buffer.concat(parts));
  }
  try {
    const response = await fetch(`http://${host}${path}${url.search}`, {
      method: request.method,
      body,
      redirect: "manual",
      cache: "no-store",
      headers: {
        "Content-Type":
          request.headers.get("content-type") ?? "application/json",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (path === "/emulator/auth/handler" && response.ok) {
      // The bundled Auth Emulator widget already has local styles and event handlers.
      // Drop its optional CDN assets so the simulated popup also works without network access.
      const widget = (await response.text())
        .replace(
          /<link href="https:\/\/(?:unpkg\.com|fonts\.googleapis\.com)\/[^"<>]*"[^>]*>/g,
          "",
        )
        .replace(/<script src="https:\/\/unpkg\.com\/[^"<>]*"><\/script>/g, "");
      return new Response(widget, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: { message: "NETWORK_REQUEST_FAILED" } },
      { status: 503 },
    );
  }
}
