import { spawn } from "node:child_process";
import { once } from "node:events";

if (
  process.env.NEXT_PUBLIC_DEMO_MODE !== "1" ||
  !process.env.FIRESTORE_EMULATOR_HOST
) {
  throw new Error(
    "The integration suite runs only against the keyless Firebase Emulator Suite.",
  );
}
const liveProbe = process.argv.includes("--gemini-probe");
if (
  liveProbe &&
  (!process.env.GEMINI_API_KEY ||
    process.env.FIREBASE_PROJECT_ID !== "demo-learning-studio" ||
    ![
      process.env.FIREBASE_AUTH_EMULATOR_HOST,
      process.env.FIRESTORE_EMULATOR_HOST,
      process.env.FIREBASE_STORAGE_EMULATOR_HOST,
    ].every((host) => /^127\.0\.0\.1:\d+$/.test(host ?? "")))
) {
  throw new Error(
    "Live verification requires Gemini credentials and local Firebase emulators.",
  );
}
const env = {
  ...process.env,
  APP_BASE_URL: "http://127.0.0.1:3000",
  PORT: "3000",
  DEMO_PUBLIC_PREVIEW: "0",
  AI_PROVIDER: liveProbe ? "gemini" : "demo",
  NEXT_TELEMETRY_DISABLED: "1",
};
const server = spawn(
  process.execPath,
  ["--env-file-if-exists=.env.local", "scripts/start.mjs"],
  { env, stdio: ["ignore", "pipe", "inherit"] },
);
const exit = once(server, "exit");
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("The built app did not become ready.")),
    30_000,
  );
  let tail = "";
  server.stdout.on("data", (buffer) => {
    const text = buffer.toString();
    process.stdout.write(text);
    tail = (tail + text).slice(-2000);
    if (tail.includes("Ready in")) {
      clearTimeout(timeout);
      resolve();
    }
  });
  server.once("exit", () => {
    clearTimeout(timeout);
    reject(new Error("The built app exited."));
  });
});
async function npmRun(script, args = []) {
  console.log(
    `$ npm run ${script}${args.length ? ` -- ${args.join(" ")}` : ""}`,
  );
  const child = spawn(
    "npm",
    ["run", script, ...(args.length ? ["--", ...args] : [])],
    { env, stdio: "inherit" },
  );
  const [status] = await once(child, "exit");
  if (status !== 0) throw new Error(`${script} failed (${status})`);
}
try {
  await ready;
  const health = await fetch(`${env.APP_BASE_URL}/api/health`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!health.ok || (await health.json()).status !== "ok")
    throw new Error("Health check failed.");
  console.log("Health check: HTTP 200.");
  await npmRun("seed");
  if (liveProbe) {
    const start = performance.now();
    try {
      await npmRun("embed", ["--verify"]);
      console.log(
        JSON.stringify({
          workflow: "embeddings",
          result: "PASS",
          ms: Math.round(performance.now() - start),
        }),
      );
    } catch {
      console.error(
        JSON.stringify({
          workflow: "embeddings",
          result: "FAIL",
          ms: Math.round(performance.now() - start),
        }),
      );
      process.exitCode = 1;
    }
    await npmRun("test:gemini");
    if (env.RUN_GEMINI_QUALITY === "1") await npmRun("eval:quality");
  } else {
    await npmRun("embed", ["--verify"]);
    await npmRun("test:tutor");
    await npmRun("test:rules");
    await npmRun("test:api");
    await npmRun("test:e2e");
    await npmRun("eval:tutor");
    await npmRun("eval:quality");
    console.log("Local CI integration sequence passed.");
  }
} finally {
  server.kill();
  await exit;
}
