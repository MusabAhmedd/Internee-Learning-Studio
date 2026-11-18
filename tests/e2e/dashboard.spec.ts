import { expect, test } from "@playwright/test";

test("sample cohort heatmap, learner plan, and focused practice reflect the seed", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back, Noor." }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("SAMPLE DATA", { exact: true })).toBeVisible();
  await expect(page.getByTestId("mastery-RAG")).toContainText("32%");
  await expect(page.getByTestId("mastery-Prompt engineering")).toContainText(
    "88%",
  );
  await expect(page.getByText("2 of 6 lessons complete")).toBeVisible();
  console.log(
    "Heatmap matches SAMPLE attempts: RAG 32%, Prompt engineering 88%; 2 of 6 lessons completed.",
  );
  await page.getByRole("button", { name: "Generate weekly recap" }).click();
  await expect(
    page.getByText(/completed 2 lessons and answered 9 of 11 quiz questions/),
  ).toBeVisible();
  await page.getByRole("link", { name: "View study plan" }).click();
  await page.getByRole("button", { name: "Generate study plan" }).click();
  await expect(page.locator(".plan-day")).toHaveCount(7);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("link", { name: "Practice this" }).click();
  await expect(page.getByText("Focus topic: RAG")).toBeVisible();
  await page.getByRole("button", { name: "Start practice quiz" }).click();
  await page.getByRole("radio", { name: "Generation", exact: true }).check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Not quite", { exact: true })).toBeVisible();
  const adapted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/plan") &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await page.getByRole("link", { name: "Study plan", exact: true }).click();
  await adapted;
  await expect(page.locator(".plan-day")).toHaveCount(7);
  console.log(
    "After a low quiz score, opening Study plan automatically refreshed the plan.",
  );
});
