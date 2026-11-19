import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type PromptName =
  "tutor" | "plan" | "quiz-generate" | "quiz-grade" | "summary";
const cache = new Map<PromptName, Promise<string>>();
export function systemPrompt(name: PromptName) {
  const existing = cache.get(name);
  if (existing) return existing;
  const pending = readFile(
    join(
      process.cwd(),
      "prompts",
      `${name}.${name === "tutor" ? "v2" : "v1"}.md`,
    ),
    "utf8",
  ).catch((error) => {
    cache.delete(name);
    throw error;
  });
  cache.set(name, pending);
  return pending;
}
export function untrustedData(data: unknown) {
  const encoded = JSON.stringify(data).replace(
    /[<>&]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `<UNTRUSTED_DATA>\n${encoded}\n</UNTRUSTED_DATA>`;
}
