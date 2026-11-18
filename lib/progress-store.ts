import { db } from "./firebase-admin";
import { progressSchema, uidSchema } from "./schemas";
export async function completions(uid: string) {
  const result = await db()
    .collection(`users/${uidSchema.parse(uid)}/progress`)
    .limit(400)
    .get();
  return result.docs.map((snap) => progressSchema.parse(snap.data()));
}
