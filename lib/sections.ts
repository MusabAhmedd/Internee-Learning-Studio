import { z } from "zod";
import { idSchema, text } from "./schemas";

export const sectionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,67}$/),
  title: text(2, 110),
  text: text(16, 1600, true),
});
export type Section = z.infer<typeof sectionSchema>;

export function sections(lessonId: string, content: string): Section[] {
  const id = idSchema.parse(lessonId);
  const rows = content.split(/^## +/m);
  if (rows[0]?.trim() !== "" || rows.length < 2 || rows.length > 9)
    throw new Error(
      "Lesson content must start with a ## heading and have at most eight sections.",
    );
  return rows.slice(1).map((row, index) => {
    const line = row.indexOf("\n");
    return sectionSchema.parse({
      id: `${id}--${String(index + 1).padStart(2, "0")}`,
      title: row.slice(0, line).trim(),
      text: line < 0 ? "" : row.slice(line + 1).trim(),
    });
  });
}
