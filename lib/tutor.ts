import { createHash } from "node:crypto";
import { db } from "./firebase-admin";
import { HttpError } from "./http";
import { aiMode, streamTutor, terms, type ProviderOptions } from "./openai";
import { sections } from "./sections";
import { systemPrompt, untrustedData } from "./prompts";
import { retrieve, type IndexedChunk } from "./rag";
import {
  chatSchema,
  chatViewSchema,
  idSchema,
  tutorTurnSchema,
  uidSchema,
  type Citation,
  type LessonView,
  type TutorMode,
  type TutorTurn,
} from "./schemas";

const abstain =
  "I can only answer from this lesson. Try asking about one of its sections.";
const refFor = (uid: string, lessonId: string) =>
  db().doc(
    `chats/${createHash("sha256")
      .update(`${uidSchema.parse(uid)}\0${idSchema.parse(lessonId)}`)
      .digest("hex")}`,
  );
export async function getChat(uid: string, lessonId: string) {
  const snap = await refFor(uid, lessonId).get();
  const prior = snap.exists ? chatSchema.parse(snap.data()) : null;
  if (prior && (prior.uid !== uid || prior.lessonId !== lessonId))
    throw new HttpError(
      403,
      "FORBIDDEN",
      "This chat does not belong to your account.",
    );
  return chatViewSchema.parse({
    messages: prior?.messages ?? [],
    provider: aiMode(),
  });
}
export async function appendChat(
  uid: string,
  lessonId: string,
  turn: TutorTurn,
) {
  const ref = refFor(uid, lessonId);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const chat = snapshot.exists
      ? chatSchema.parse(snapshot.data())
      : { uid, lessonId, messages: [] };
    if (chat.uid !== uid || chat.lessonId !== lessonId)
      throw new HttpError(
        403,
        "FORBIDDEN",
        "This chat does not belong to your account.",
      );
    const row = chatSchema.parse({
      ...chat,
      messages: [...chat.messages, tutorTurnSchema.parse(turn)].slice(-12),
    });
    tx.set(ref, row);
  });
}
const cite = (row: IndexedChunk): Citation => ({
  lessonId: row.lessonId,
  chunkId: row.id,
});
const sentence = (value: string) =>
  value.match(/^.+?[.!?](?=\s|$)/s)?.[0] ?? value;
function staticAnswer(
  text: string,
  citations: Citation[],
  emit: (value: string) => void,
) {
  for (const piece of text.match(/\S+\s*/g) ?? []) emit(piece);
  return { answer: text, citations };
}
export function isInjection(message: string) {
  return (
    /^(?:please\s+)?(?:ignore|disregard|override|forget)\b[\s\S]{0,130}\b(instructions?|system|prompt)\b/i.test(
      message,
    ) ||
    /\b(?:reveal|print|dump) (?:the |your )?(?:system prompt|api key|developer message)\b/i.test(
      message,
    )
  );
}
// Reject obvious pasted role overrides before any extractive output or model call.
// This is not a general prompt-injection detector or a factual verifier.
const containsRoleOverride = (source: string) =>
  /(?:^|\n)\s*(?:\[+\s*)?(?:system|developer)\s*(?:\]+)?\s*:\s*(?:ignore|disregard|override|respond|output|print|reveal|return)\b/i.test(
    source,
  );
export async function tutorAnswer(
  view: LessonView,
  mode: TutorMode,
  question: string,
  history: TutorTurn[],
  provider: ProviderOptions,
  emit: (value: string) => void,
  beforeHint?: () => Promise<void>,
) {
  if (isInjection(question)) return staticAnswer(abstain, [], emit);
  if (mode === "hint") {
    // A fixed hint never needs a remote query embedding or the answer key.
    const words = terms(question);
    const ranked = sections(view.lesson.id, view.lesson.content)
      .map((section) => {
        const heading = new Set(terms(section.title));
        const source = new Set(terms(section.text));
        const score = words.reduce(
          (sum, term) =>
            sum + (heading.has(term) ? 2 : 0) + (source.has(term) ? 1 : 0),
          0,
        );
        return { section, score };
      })
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || (!best.score && !beforeHint))
      return staticAnswer(abstain, [], emit);
    await beforeHint?.();
    return staticAnswer(
      "What clue in the source helps rule out an incorrect approach? Describe that clue first, then use it to work out your next step.",
      [{ lessonId: view.lesson.id, chunkId: best.section.id }],
      emit,
    );
  }
  const genericSummary =
    mode === "summarize" &&
    /^(summarize|recap)( the| this)?( lesson)?[.!]?$/i.test(question);
  const chunks = (
    await retrieve(view, question, provider, genericSummary)
  ).filter((row) => !containsRoleOverride(row.text));
  if (!chunks.length) return staticAnswer(abstain, [], emit);
  if (aiMode() === "demo") {
    // NOT_IMPLEMENTED (demo provider only): model inference. This no-key mode is an extractive source preview.
    if (mode === "quiz")
      return staticAnswer(
        `In your own words, what is the key idea of “${chunks[0].sectionTitle}”? Give one example from this lesson.`,
        [cite(chunks[0])],
        emit,
      );
    if (mode === "summarize")
      return staticAnswer(
        chunks.map((row) => sentence(row.text)).join(" "),
        chunks.map(cite),
        emit,
      );
    return staticAnswer(chunks[0].text, [cite(chunks[0])], emit);
  }
  const prompt = await systemPrompt("tutor");
  const input = untrustedData({
    mode,
    question,
    recent: history.slice(-2).map((row) => ({
      question: row.message,
      answer: row.answer.slice(0, 450),
    })),
    excerpts: chunks.map((row, i) => ({
      slot: i + 1,
      title: row.sectionTitle,
      text: row.text,
    })),
  });
  let buf = "",
    answer = "";
  let citations: Citation[] | undefined;
  const write = (value: string) => {
    if (!value) return;
    if (answer.length + value.length > 4500)
      throw new HttpError(
        502,
        "AI_INCOMPLETE",
        "The tutor response exceeded its output budget.",
      );
    answer += value;
    emit(value);
  };
  for await (const delta of streamTutor(prompt, input, provider)) {
    if (citations) {
      write(delta);
      continue;
    }
    buf += delta;
    const line = buf.indexOf("\n");
    if (line < 0 && buf.length <= 40) continue;
    const header = buf.slice(0, line).trim();
    if (header === "OFF_TOPIC") return staticAnswer(abstain, [], emit);
    const slots = header
      .match(/^SOURCES: ([1-3](?:,[1-3]){0,2})$/)?.[1]
      ?.split(",")
      .map(Number);
    if (
      !slots ||
      new Set(slots).size !== slots.length ||
      slots.some((slot) => !chunks[slot - 1])
    )
      throw new HttpError(
        502,
        "AI_FORMAT",
        "The tutor could not verify its sources. Try rephrasing your question.",
      );
    citations = slots.map((slot) => cite(chunks[slot - 1]));
    write(buf.slice(line + 1));
    buf = "";
  }
  if (buf.trim() === "OFF_TOPIC") return staticAnswer(abstain, [], emit);
  if (!citations?.length || !answer.trim())
    throw new HttpError(
      502,
      "AI_FORMAT",
      "The tutor returned no supported answer. Try again.",
    );
  return { answer: answer.trim(), citations };
}
