import { expect, test } from "@playwright/test";

test("mobile navigation is keyboard operable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("mastery-RAG")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  const menu = page.getByRole("button", { name: "Open menu" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Close menu" }),
  ).toHaveAttribute("aria-expanded", "true");
  const modules = page.getByRole("link", { name: "Modules", exact: true });
  await modules.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Learning modules" }),
  ).toBeVisible();
  console.log(
    "Mobile: 390px viewport, no horizontal overflow, keyboard menu and route navigation passed.",
  );
});
