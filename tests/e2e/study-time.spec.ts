import { expect, test } from "@playwright/test";
import { adminAuth } from "../../lib/firebase-admin-auth";
import { db } from "../../lib/firebase-admin";
import { progressSchema } from "../../lib/schemas";

test("visible lesson time persists periodically, on hide and on page exit", async ({
  page,
}) => {
  test.setTimeout(50_000);
  const dashboard = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/dashboard",
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back, Noor." }),
  ).toBeVisible({ timeout: 15_000 });
  const authorization = await (await dashboard).headerValue("authorization");
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token)
    throw new Error(
      "Expected a Firebase session for the demo dashboard request.",
    );
  const { uid } = await adminAuth().verifyIdToken(token);
  const read = async () => {
    const snap = await db().doc(`users/${uid}/progress/rag`).get();
    const row = snap.exists ? progressSchema.parse(snap.data()) : null;
    return (row?.studySeconds ?? 0) * 1000 + (row?.studyRemainderMs ?? 0);
  };
  const visibility = (value: "hidden" | "visible") =>
    page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", {
        value,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, value);
  await page.goto("/lesson/rag");
  await expect(
    page.getByRole("button", { name: "Mark lesson complete" }),
  ).toBeVisible();
  await expect.poll(read, { timeout: 22_000 }).toBeGreaterThanOrEqual(14_000);
  const heartbeat = await read();
  await visibility("hidden");
  await expect.poll(read).toBeGreaterThan(heartbeat);
  const hidden = await read();
  await page.waitForTimeout(1200);
  expect(await read()).toBe(hidden);
  await visibility("visible");
  await page.waitForTimeout(1100);
  await page.goto("/modules"); // Force an actual document unload (pagehide).
  await expect.poll(read).toBeGreaterThan(hidden + 700);
  expect(await read()).toBeLessThan(hidden + 2200);
  console.log(
    "Study tracking: periodic write, hidden-tab pause, and keepalive on actual page exit verified.",
  );
});
