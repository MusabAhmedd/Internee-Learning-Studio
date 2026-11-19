import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const command = (file, args, options = {}) =>
  execFileSync(file, args, { maxBuffer: 16 * 1024 * 1024, ...options });
const git = (args, options) => command("git", args, options);
const digest = (blob) => createHash("sha256").update(blob).digest("hex");
const prefix = "internee-learning-studio/";
const allowedTop = new Set([
  ".dockerignore",
  ".env.example",
  ".gitignore",
  ".nvmrc",
  ".prettierignore",
  "Dockerfile",
  "README.md",
  "components.json",
  "docker-compose.yml",
  "eslint.config.mjs",
  "firebase.json",
  "firestore.indexes.json",
  "firestore.rules",
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "playwright.config.ts",
  "postcss.config.mjs",
  "storage.rules",
  "tsconfig.build.json",
  "tsconfig.json",
]);
const folder =
  /^(?:(?:app|components|data|docs|lib|prompts|public|scripts|tests)\/|\.github\/workflows\/)/;
const junk = new Set([
  ".git",
  ".config",
  ".cache",
  ".next",
  ".npm",
  ".local",
  ".arena",
  ".firebase",
  ".eval-local",
  ".release-local",
  ".turbo",
  ".output",
  ".idea",
  ".vscode",
  "node_modules",
  "dist",
  "out",
  "build",
  "coverage",
  "target",
  "playwright-report",
  "test-results",
  "firebase-emulator-data",
  "__pycache__",
  ".ds_store",
  "thumbs.db",
  "next-env.d.ts",
]);
const indicators = [
  /\bAIza[\w-]{35}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{29,}|github_pat_[A-Za-z0-9_]{35,})\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/]{16}/,
  /"type"\s*:\s*"service_account"/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{12,}/,
];

function allowed(name) {
  if (!/^[A-Za-z0-9_.\-/\[\]@]+$/.test(name)) return false;
  const parts = name.toLowerCase().split("/");
  const sensitive = parts.some(
    (part) =>
      part === "" ||
      part === ".." ||
      part === "." ||
      junk.has(part) ||
      (part.startsWith(".env") && name !== ".env.example"),
  );
  const local =
    /\.(?:zip|7z|rar|tar|tgz|gz|bz2|xz|log(?:\..*)?|tsbuildinfo|bak|pem|key|p12|pfx)$/i.test(
      name,
    ) ||
    /(?:^|\/)(?:\.netrc|\.npmrc|\.gitconfig|credentials\.json|service[-_]?account.*\.json)$/i.test(
      name,
    );
  return !sensitive && !local && (allowedTop.has(name) || folder.test(name));
}

function main() {
  const checkOnly = process.argv[2] === "--check";
  if (process.argv.length > (checkOnly ? 3 : 2))
    throw new Error("Use npm run release:check or npm run release:zip.");
  const commit = git(["rev-parse", "--verify", "HEAD"]).toString().trim();
  const worktree = spawnSync("git", ["diff", "--quiet", commit, "--"]);
  if (worktree.status !== 0)
    throw new Error("Commit tracked changes before auditing a release.");
  const tracked = git(["ls-tree", "-r", "-z", "--full-tree", commit])
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      const [mode, type, id] = meta.split(" ");
      if (
        !path ||
        !allowed(path) ||
        type !== "blob" ||
        !["100644", "100755"].includes(mode)
      )
        throw new Error(`Disallowed tracked entry: ${JSON.stringify(path)}`);
      return { path, id };
    });
  const ignore = spawnSync(
    "git",
    ["check-ignore", "--no-index", "-z", "--stdin"],
    { input: tracked.map((row) => row.path).join("\0") + "\0" },
  );
  if (ignore.status !== 1)
    throw new Error(
      `Release candidates match ignore rules or ignore verification failed: ${ignore.stdout.toString().replaceAll("\0", " ").trim()}`,
    );
  const files = new Map();
  for (const { path, id } of tracked) {
    const bytes = git(["cat-file", "blob", id]);
    if (!bytes.includes(0)) {
      const source = bytes.toString("utf8");
      if (indicators.some((pattern) => pattern.test(source)))
        throw new Error(`Possible credential in ${path}; contents omitted.`);
      if (
        path === ".env.example" &&
        /^(?:GEMINI_API_KEY|FIREBASE_PRIVATE_KEY|FIREBASE_CLIENT_EMAIL|EVAL_ID_TOKEN|EVAL_APP_CHECK_TOKEN|GITHUB_TOKEN|VERCEL_TOKEN)\s*=\s*\S+/m.test(
          source,
        )
      )
        throw new Error("The env template must not assign credential values.");
    }
    files.set(path, digest(bytes));
  }
  console.log(
    `Release source gate: ${files.size} regular files from ${commit}; path policy, ignore rules, and credential-pattern scan passed.`,
  );
  if (checkOnly) return;
  const archive = resolve(
    ".release-local/internee-learning-studio-reviewed.zip",
  );
  const work = `${archive}.${process.pid}.tmp`;
  mkdirSync(dirname(archive), { recursive: true });
  try {
    git([
      "archive",
      "--format=zip",
      `--prefix=${prefix}`,
      `--output=${work}`,
      commit,
    ]);
    command("unzip", ["-tq", work]);
    const members = command("unzip", ["-Z1", work])
      .toString()
      .trimEnd()
      .split("\n");
    const directories = new Set([prefix]);
    for (const path of files.keys()) {
      const parts = path.split("/");
      parts.pop();
      for (let i = 1; i <= parts.length; i++)
        directories.add(`${prefix}${parts.slice(0, i).join("/")}/`);
    }
    const expected = new Set([
      ...directories,
      ...[...files.keys()].map((path) => prefix + path),
    ]);
    if (
      members.length !== expected.size ||
      new Set(members).size !== expected.size ||
      members.some((path) => !expected.has(path))
    )
      throw new Error(
        "Archive directory/file manifest differs from the audited Git tree.",
      );
    const sha256 = digest(readFileSync(work));
    renameSync(work, archive);
    writeFileSync(
      `${archive}.manifest.txt`,
      [
        `Source commit: ${commit}`,
        `Archive: internee-learning-studio-reviewed.zip`,
        `Archive SHA-256: ${sha256}`,
        `Verified regular files: ${files.size}`,
        "Archive CRC check: passed",
        "Exact source manifest (SHA-256  path relative to the archive root):",
        ...[...files].map(([path, hash]) => `${hash}  ${path}`),
        "",
      ].join("\n"),
    );
    console.log(`ZIP integrity and exact member set passed. SHA-256 ${sha256}`);
    console.log(`Archive and full manifest: ${archive}{,.manifest.txt}`);
  } finally {
    rmSync(work, { force: true });
  }
}
try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Release validation failed.",
  );
  process.exitCode = 1;
}
