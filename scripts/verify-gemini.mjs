import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const required = ["GEMINI_API_KEY", "OPENAI_CHAT_MODEL", "OPENAI_EMBED_MODEL"];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error(
    `NOT RUN: configure ${missing.join(", ")} in the local secret environment.`,
  );
  process.exitCode = 2;
} else if (
  process.env.NEXT_PUBLIC_DEMO_MODE !== "1" ||
  process.env.FIREBASE_PROJECT_ID !== "demo-learning-studio" ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== "demo-learning-studio"
) {
  console.error(
    "NOT RUN: the live Gemini probe sends only SAMPLE data and requires the demo Firebase configuration.",
  );
  process.exitCode = 2;
} else if (!existsSync(".next/standalone/server.js")) {
  console.error(
    "NOT RUN: run npm run build with the demo Firebase configuration first.",
  );
  process.exitCode = 2;
} else {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("firebase-tools/package.json");
  const cli = resolve(dirname(manifest), require(manifest).bin.firebase);
  const command =
    "node --env-file-if-exists=.env.local scripts/ci-integration.mjs --gemini-probe";
  const child = spawn(
    process.execPath,
    [
      cli,
      "emulators:exec",
      "--project",
      "demo-learning-studio",
      "--only",
      "auth,firestore,storage",
      command,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DEMO_PUBLIC_PREVIEW: "0",
        AI_PROVIDER: "gemini",
        AI_DAILY_LIMIT: "40",
      },
    },
  );
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
}
