import { createHash } from "node:crypto";
import { db } from "./firebase-admin";
import {
  attemptSchema,
  masterySchema,
  topicSchema,
  uidSchema,
} from "./schemas";
export function masteryId(uid: string, topic: string) {
  return `${uidSchema.parse(uid)}_${createHash("sha256").update(topicSchema.parse(topic)).digest("hex")}`;
}
export async function recentAttempts(uid: string, limit = 160) {
  const result = await db()
    .collection("attempts")
    .where("uid", "==", uidSchema.parse(uid))
    .orderBy("at", "desc")
    .limit(limit)
    .get();
  return result.docs.map((row) => attemptSchema.parse(row.data()));
}
export async function topicMastery(uid: string) {
  const result = await db()
    .collection("mastery")
    .where("uid", "==", uidSchema.parse(uid))
    .limit(125)
    .get();
  return result.docs.map((row) => masterySchema.parse(row.data()));
}
