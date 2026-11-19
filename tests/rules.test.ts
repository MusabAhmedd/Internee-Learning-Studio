import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import {
  attemptSchema,
  masterySchema,
  profileSchema,
  progressSchema,
} from "../lib/schemas";

let env: RulesTestEnvironment;
const projectId = "demo-learning-studio-rules";
const alice = "learner-a",
  bob = "learner-b";
const now = new Date().toISOString();
const profile = profileSchema.parse({
  displayName: "Sample Learner",
  track: "Generative AI",
  level: "Beginner",
  weeklyHours: 4,
  goal: "Practice grounding answers in a lesson.",
  createdAt: now,
});
before(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_STORAGE_EMULATOR_HOST
  )
    throw new Error("Run the Firebase emulators before the rules suite.");
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile("firestore.rules", "utf8") },
    storage: { rules: await readFile("storage.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      ...[alice, bob].flatMap((uid) => [
        setDoc(doc(database, "users", uid), profile),
        setDoc(
          doc(database, "users", uid, "progress", "rag"),
          progressSchema.parse({
            uid,
            lessonId: "rag",
            studySeconds: 600,
            completedAt: now,
          }),
        ),
        setDoc(
          doc(database, "attempts", `${uid}-q`),
          attemptSchema.parse({
            uid,
            lessonId: "rag",
            questionId: "q-01",
            topic: "RAG",
            correct: false,
            hintsUsed: 1,
            at: now,
            answer: "Sample response",
            feedback: "Review the source.",
          }),
        ),
        setDoc(
          doc(database, "mastery", `${uid}-rag`),
          masterySchema.parse({
            uid,
            topic: "RAG",
            score: 0.3,
            attemptCount: 3,
            updatedAt: now,
          }),
        ),
        setDoc(doc(database, "chats", `${uid}-rag`), {
          uid,
          lessonId: "rag",
          messages: [],
        }),
        setDoc(doc(database, "plans", uid), { uid, days: [], createdAt: now }),
        setDoc(doc(database, "summaries", uid), { uid, text: "Private recap" }),
      ]),
      setDoc(doc(database, "modules", "rag-module"), { title: "RAG" }),
      setDoc(doc(database, "modules", "rag-module", "lessons", "rag"), {
        title: "Sample lesson",
      }),
      setDoc(
        doc(
          database,
          "modules",
          "rag-module",
          "lessons",
          "rag",
          "quizzes",
          "q-01",
        ),
        { answer: "Server-side only" },
      ),
      setDoc(doc(database, "quizQuestions", "q-01"), {
        uid: alice,
        spec: { answer: "Server-side only" },
      }),
      setDoc(doc(database, "lessons_chunks", "rag--01"), {
        text: "Reference chunk",
      }),
    ]);
    await uploadBytes(
      ref(
        context.storage(`gs://${projectId}.appspot.com`),
        "curricula/SAMPLE.json",
      ),
      new TextEncoder().encode("{}"),
    );
  });
});
after(async () => {
  await env?.cleanup();
});

test("user A can read their own profile and cannot read user B profile or progress", async () => {
  const database = env.authenticatedContext(alice).firestore();
  await assertSucceeds(getDoc(doc(database, "users", alice)));
  await assertFails(getDoc(doc(database, "users", bob)));
  await assertFails(getDoc(doc(database, "users", bob, "progress", "rag")));
  await assertFails(getDocs(collection(database, "users")));
});
test("user A cannot read user B attempts, mastery, plan, summary, or chat", async () => {
  const database = env.authenticatedContext(alice).firestore();
  for (const [collectionId, id] of [
    ["attempts", `${bob}-q`],
    ["mastery", `${bob}-rag`],
    ["plans", bob],
    ["summaries", bob],
    ["chats", `${bob}-rag`],
    ["studyCursors", alice],
    ["serviceLimits", "gemini"],
    ["providerLimits", alice],
  ])
    await assertFails(getDoc(doc(database, collectionId, id)));
  await assertSucceeds(
    getDocs(query(collection(database, "attempts"), where("uid", "==", alice))),
  );
  await assertFails(
    getDocs(query(collection(database, "attempts"), where("uid", "==", bob))),
  );
  await assertFails(getDocs(collection(database, "attempts")));
});
test("answer keys and embeddings stay private; a signed-in learner may read published lessons", async () => {
  const client = env.authenticatedContext(alice).firestore();
  const guest = env.unauthenticatedContext().firestore();
  const lesson = ["modules", "rag-module", "lessons", "rag"];
  await assertSucceeds(getDoc(doc(client, lesson.join("/"))));
  await assertFails(getDoc(doc(guest, lesson.join("/"))));
  await assertFails(
    getDoc(doc(client, [...lesson, "quizzes", "q-01"].join("/"))),
  );
  await assertFails(getDoc(doc(client, "quizQuestions", "q-01")));
  await assertFails(getDoc(doc(client, "lessons_chunks", "rag--01")));
});
test("client writes cannot forge profile changes, attempts, or imported curriculum, even with admin claim", async () => {
  const client = env.authenticatedContext(alice).firestore();
  const adminClient = env
    .authenticatedContext("test-admin", { admin: true })
    .firestore();
  await assertFails(setDoc(doc(client, "users", bob), profile));
  await assertFails(setDoc(doc(client, "users", alice), profile));
  await assertFails(
    setDoc(doc(client, "users", alice, "progress", "rag"), {
      studySeconds: 7200,
    }),
  );
  await assertFails(
    setDoc(doc(client, "attempts", `${alice}-q`), {
      uid: alice,
      correct: true,
    }),
  );
  await assertFails(
    setDoc(doc(adminClient, "modules", "fake"), {
      title: "Unvalidated document",
    }),
  );
});
test("Storage archives are private and browser uploads cannot bypass the admin route", async () => {
  const storage = env
    .authenticatedContext(alice, { admin: true })
    .storage(`gs://${projectId}.appspot.com`);
  await assertFails(getBytes(ref(storage, "curricula/SAMPLE.json")));
  await assertFails(
    uploadBytes(
      ref(storage, "curricula/unauthorized.json"),
      new TextEncoder().encode("{}"),
    ),
  );
});
