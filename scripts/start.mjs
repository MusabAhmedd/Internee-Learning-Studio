import { cpSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const target = join(root, ".next/standalone");
cpSync(join(root, "public"), join(target, "public"), { recursive: true });
cpSync(join(root, ".next/static"), join(target, ".next/static"), {
  recursive: true,
});
process.env.HOSTNAME = "0.0.0.0";
await import("../.next/standalone/server.js");
