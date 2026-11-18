import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { adminAuth, db, isDemo } from "../../lib/firebase-admin";
import { profileSchema } from "../../lib/schemas";

test("email signup persists an onboarding profile in Firestore across reload", async ({
  page,
}) => {
  if (!isDemo()) throw new Error("This test requires the Firebase emulators.");
  const email = `jury-${randomUUID()}@example.test`;
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(`Sample!${randomUUID()}`);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make it yours" }),
  ).toBeVisible();
  await page.getByLabel("Display name").fill("Jury Learner");
  await page.getByLabel("Weekly study hours").fill("6");
  await page
    .getByLabel("Learning goal")
    .fill("Build a grounded tutor with clear citations.");
  await page.getByRole("button", { name: "Save learning profile" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const user = await adminAuth().getUserByEmail(email);
  const saved = () =>
    db()
      .doc(`users/${user.uid}`)
      .get()
      .then((snap) => profileSchema.parse(snap.data()));
  const before = await saved();
  expect(before).toMatchObject({
    displayName: "Jury Learner",
    track: "Generative AI",
    weeklyHours: 6,
    goal: "Build a grounded tutor with clear citations.",
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /Welcome.*Jury/ }),
  ).toBeVisible();
  expect(await saved()).toEqual(before);
  console.log("Firestore: profile matched before and after browser reload.");
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Learning modules" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Prompt anatomy/ }).click();
  await expect(
    page.getByRole("heading", { name: "Anatomy of a useful prompt" }),
  ).toBeVisible();
  console.log("Browser: module catalog and SAMPLE lesson rendered.");
  await page.getByRole("button", { name: "Start practice quiz" }).click();
  await page.getByRole("radio", { name: "Output format", exact: true }).check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(
    page.getByText("Correct. Your choice matches the lesson."),
  ).toBeVisible();
  const attempts = await db()
    .collection("attempts")
    .where("uid", "==", user.uid)
    .get();
  expect(attempts.size).toBe(1);
  console.log("Browser: correct quiz answer recorded in Firestore.");
  await page.getByRole("button", { name: "Next question" }).click();
  await page
    .getByLabel("Why supply a few input–output examples?")
    .fill("To demonstrate the desired pattern or format.");
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(
    page.getByText("Matches the sample answer’s key concepts."),
  ).toBeVisible();
  console.log("Browser: sample short-answer feedback returned.");
});
