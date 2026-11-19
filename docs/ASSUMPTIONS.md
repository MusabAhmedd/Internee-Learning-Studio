# Implementation decisions

- The explicit request for a free alternative takes precedence over calling OpenAI. Gemini Developer API is accessed using the official OpenAI Node SDK against Google's documented compatibility endpoint. The requested `OPENAI_CHAT_MODEL` / `OPENAI_EMBED_MODEL` names are model settings only; no OpenAI account is required.
- This is a single TypeScript Next.js app with separated UI, server routes, AI modules and configuration. There is no Python service, Flask, or extra framework to deploy. The Docker packaging is for the Next.js service.
- No organization data was supplied. SAMPLE is an original training curriculum, not official Internee.pk content. The only seeded track is Generative AI; the schema supports other tracks through curriculum import.
- The checked-in environment template is for a fake Firebase project with local emulators. The preview cannot access a real Firebase project. Keyless demo tutor responses and scores do not measure the hosted model.

- The API example lists an `answer` key on quiz generation. The learner-facing response intentionally omits it to prevent answer leakage and grade manipulation. The validated answer and rubric stay in private Firestore documents and are used by the grade route.
- Firestore security rules allow own-data reads. Writes use authenticated server endpoints rather than direct browser writes so the service can validate types, ownership, quotas, and derived scores. The admin claim is checked both in the token and against the current Firebase Auth record for admin requests.
- Study planning uses seven local calendar dates starting today in the profile’s IANA time zone and the hours from the saved profile. Re-planning responds to missed incomplete lessons, low recent scores, profile/catalog changes, and expired weeks on the next visit to Overview or Study plan. The initial mastery score is 0.5.
- Completion and time are learner activity records, not proctoring. The PDF does not represent an official credential. Dashboard accuracy uses bounded recent history; mastery uses all accepted attempts incrementally.
- The demo’s intentional non-model paths have `NOT_IMPLEMENTED (demo provider only)` markers. Live mode does not silently use sample output. A temporary Arena preview is not a Vercel deployment.
