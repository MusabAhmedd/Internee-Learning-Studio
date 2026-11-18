import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("Google Auth Emulator popup reaches onboarding", async ({ page }) => {
  await page.goto("/login");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const popup = await opened;
  await popup.waitForLoadState("domcontentloaded");
  // These are the installed Firebase Auth Emulator widget IDs, not live Google pages.
  await popup.locator("#add-account-button").click();
  await popup
    .locator("#email-input")
    .fill(`mock-google-${randomUUID()}@example.test`);
  await popup.locator("#display-name-input").fill("Google Sample");
  await popup.locator("#sign-in").click();
  await expect(
    page.getByRole("heading", { name: "Make it yours" }),
  ).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue("Google Sample");
  console.log(
    "Simulated provider popup created a Firebase session; hosted Google OAuth was not exercised.",
  );
});
