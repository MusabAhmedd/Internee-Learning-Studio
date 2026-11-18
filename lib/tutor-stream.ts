import { tutorFrameSchema, type Citation } from "./schemas";

export async function readTutor(
  response: Response,
  onDelta: (text: string) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The tutor did not return a stream.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    text = "";
  let citations: Citation[] | undefined;
  const line = (value: string) => {
    if (!value.trim()) return;
    const event = tutorFrameSchema.parse(JSON.parse(value));
    if (citations) throw new Error("Unexpected frame after tutor completion.");
    if (event.type === "error") throw new TutorStreamError(event.error.message);
    if (event.type === "delta") {
      text += event.text;
      if (text.length > 4500) throw new Error("Tutor message exceeds limit.");
      onDelta(event.text);
    } else citations = event.citations;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 120_000)
        throw new Error("Tutor frame exceeds limit.");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    line(buffer + decoder.decode());
    if (citations === undefined || !text.trim())
      throw new TutorStreamError(
        "The answer was interrupted. Retry when connected.",
      );
    return { text: text.trim(), citations };
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export class TutorStreamError extends Error {}
