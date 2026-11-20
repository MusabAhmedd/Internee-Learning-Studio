import { adminAuth } from "../lib/firebase-admin-auth";
import { isDemo } from "../lib/firebase-admin";
async function main() {
  const email = process.argv[2];
  if (
    !email ||
    !email.includes("@") ||
    (!isDemo() && process.env.ALLOW_ADMIN_GRANT !== "yes") ||
    process.env.DEMO_PUBLIC_PREVIEW === "1"
  )
    throw new Error(
      "Provide a Firebase account email. Hosted grants require ALLOW_ADMIN_GRANT=yes. Not for public demos.",
    );
  const user = await adminAuth().getUserByEmail(email);
  await adminAuth().setCustomUserClaims(user.uid, {
    ...user.customClaims,
    admin: true,
  });
  console.log("Admin claim set. Sign out and sign in again to refresh it.");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
