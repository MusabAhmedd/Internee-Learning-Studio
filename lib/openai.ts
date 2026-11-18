import OpenAI from "openai";
import { z } from "zod";
import { isDemo } from "./firebase-admin";
import { HttpError } from "./http";

let client: OpenAI | undefined;
export function aiMode(): "demo" | "gemini" {
  const value = process.env.AI_PROVIDER ?? (isDemo() ? "demo" : "gemini");
  if (
    (value === "gemini" && process.env.DEMO_PUBLIC_PREVIEW !== "1") ||
    (value === "demo" && isDemo())
  )
    return value;
  throw new HttpError(503, "AI_CONFIG", "The AI provider is not configured.");
}
function gemini() {
  if (typeof window !== "undefined")
    throw new Error("The AI client is server-only.");
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    throw new HttpError(
      503,
      "AI_CONFIG",
      "Set a Gemini API key to enable live AI.",
    );
  return (client ??= new OpenAI({
    apiKey: key,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    timeout: 8000,
    maxRetries: 1,
  }));
}
function configuredModel(setting: "OPENAI_CHAT_MODEL" | "OPENAI_EMBED_MODEL") {
  const model = process.env[setting];
  if (!model || !/^[a-zA-Z0-9._-]{1,100}$/.test(model))
    throw new HttpError(
      503,
      "AI_CONFIG",
      `Configure ${setting} on the server.`,
    );
  return model;
}
export const embeddingModel = () =>
  aiMode() === "demo"
    ? "local-hashed-terms-v1"
    : configuredModel("OPENAI_EMBED_MODEL");
export const embeddingSchema = z
  .array(z.number())
  .min(64)
  .max(4096)
  .refine(
    (values) => values.some((value) => value !== 0),
    "An embedding must be nonzero.",
  );

const stop = new Set(
  "a an and are as at be been but by can could did do does for from had has have how i if in into is it its may me my of on or our should so some that the their them then these they this to us use was we were what when where which who will with would you your explain tell lesson about give please name compare different help here".split(
    " ",
  ),
);
export function terms(value: string) {
  const words = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [
    ...new Set(
      words
        .filter((word) => word.length >= 3 && !stop.has(word))
        .map((word) =>
          word.length > 5
            ? word.replace(/(ings?|ed|es|s)$/, "")
            : word.replace(/s$/, ""),
        ),
    ),
  ];
}
export function lexicalVector(input: string) {
  const vector = Array<number>(384).fill(0);
  for (const word of terms(input)) {
    let hash = 2166136261;
    for (const symbol of word)
      hash = Math.imul(hash ^ (symbol.codePointAt(0) ?? 0), 16777619);
    vector[(hash >>> 0) % vector.length] += hash & 1 ? 1 : -1;
  }
  if (!vector.some((value) => value !== 0)) vector[0] = 1;
  return vector;
}

export function aiFailure(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof OpenAI.APIError && error.status === 429)
    return new HttpError(
      429,
      "PROVIDER_LIMIT",
      "Gemini’s quota is busy. Try again a little later.",
    );
  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    (error instanceof Error && error.name === "TimeoutError")
  )
    return new HttpError(
      504,
      "AI_TIMEOUT",
      "The AI request timed out. Please retry.",
    );
  if (
    error instanceof OpenAI.APIError &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  )
    return new HttpError(
      503,
      "AI_CONFIG",
      "Gemini credentials or model access need attention.",
    );
  return new HttpError(
    502,
    "AI_UNAVAILABLE",
    "The AI provider could not complete the request. Please retry.",
  );
}

export function logAi(
  event: string,
  model: string,
  start: number,
  usage?: {
    prompt_tokens: number;
    completion_tokens?: number;
    total_tokens: number;
  } | null,
  status = "ok",
) {
  console.info(
    JSON.stringify({
      event,
      model,
      status,
      ms: Math.round(performance.now() - start),
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
    }),
  );
}
export async function embed(input: string, signal?: AbortSignal) {
  if (input.length > 8000 || !input.trim())
    throw new HttpError(
      422,
      "EMBED_INPUT",
      "Embedding input must be nonempty and within the token budget.",
    );
  const model = embeddingModel();
  if (aiMode() === "demo") return embeddingSchema.parse(lexicalVector(input));
  const start = performance.now();
  try {
    const result = await gemini().embeddings.create(
      { model, input, encoding_format: "float" },
      {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
      },
    );
    const vector = embeddingSchema.parse(result.data[0]?.embedding);
    logAi("embedding", model, start, result.usage);
    return vector;
  } catch (error) {
    const failure = aiFailure(error);
    logAi("embedding", model, start, null, failure.code);
    throw failure;
  }
}

export async function* streamTutor(
  prompt: string,
  data: string,
  signal: AbortSignal,
) {
  const model = configuredModel("OPENAI_CHAT_MODEL");
  const start = performance.now();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(22_000)]);
  let usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null = null;
  let status = "ok";
  try {
    const stream = await gemini().chat.completions.create(
      {
        model,
        stream: true,
        stream_options: { include_usage: true },
        reasoning_effort: "minimal",
        max_tokens: 560,
        temperature: 0.2,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: data },
        ],
      },
      { signal: deadline },
    );
    for await (const part of stream) {
      if (part.usage) usage = part.usage;
      const choice = part.choices?.[0];
      if (
        choice?.finish_reason === "length" ||
        choice?.finish_reason === "content_filter"
      )
        throw new HttpError(
          502,
          "AI_INCOMPLETE",
          "The tutor could not finish this answer. Try a shorter question.",
        );
      if (choice?.delta?.content) yield choice.delta.content;
    }
  } catch (error) {
    const failure = aiFailure(
      deadline.aborted && !signal.aborted ? deadline.reason : error,
    );
    status = failure.code;
    throw failure;
  } finally {
    logAi(
      "tutor_model",
      model,
      start,
      usage,
      signal.aborted ? "cancelled" : status,
    );
  }
}

export async function structured<T>(
  name: string,
  prompt: string,
  data: string,
  schema: z.ZodType<T>,
  maxTokens: number,
  signal?: AbortSignal,
) {
  if (data.length > 36_000)
    throw new HttpError(
      422,
      "AI_BUDGET",
      "This request exceeds the model input budget.",
    );
  const model = configuredModel("OPENAI_CHAT_MODEL");
  const start = performance.now();
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(24_000)])
    : AbortSignal.timeout(24_000);
  let status = "ok";
  let usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null = null;
  try {
    const wire = z.toJSONSchema(schema, { target: "draft-7" });
    delete wire.$schema;
    const response = await gemini().chat.completions.create(
      {
        model,
        reasoning_effort: "minimal",
        max_tokens: maxTokens,
        temperature: 0.15,
        response_format: {
          type: "json_schema",
          json_schema: { name, schema: wire, strict: true },
        },
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: data },
        ],
      },
      { signal: deadline, timeout: 12_000 },
    );
    usage = response.usage ?? null;
    const choice = response.choices[0];
    if (!choice || choice.finish_reason !== "stop" || !choice.message.content)
      throw new HttpError(
        502,
        "AI_FORMAT",
        "The AI could not produce a complete result. Please retry.",
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(choice.message.content);
    } catch {
      throw new HttpError(
        502,
        "AI_FORMAT",
        "The AI returned an unreadable result. Please retry.",
      );
    }
    const result = schema.safeParse(parsed);
    if (!result.success)
      throw new HttpError(
        502,
        "AI_FORMAT",
        "The AI result did not match the expected format. Please retry.",
      );
    return result.data;
  } catch (error) {
    const failure = aiFailure(
      deadline.aborted && !signal?.aborted ? deadline.reason : error,
    );
    status = failure.code;
    throw failure;
  } finally {
    logAi(name, model, start, usage, status);
  }
}
