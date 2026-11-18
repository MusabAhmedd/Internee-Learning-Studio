# Three-minute jury walkthrough

**Before the demo:** Start the Firebase emulators, seed and index the curriculum, then start the built app as described in the README. Open `/` in a fresh browser context. The **SAMPLE DATA** pill means that both the curriculum and the seeded learner are synthetic. No provider key is necessary.

| Time      | Show                                          | What to say                                                                                                                                                                                                                         |
| --------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:30 | Overview → progress ring, streak and RAG cell | “The heatmap is computed from saved quiz attempts. Focus areas require enough practice history, not just one wrong answer.”                                                                                                         |
| 0:30–1:10 | Continue learning → RAG tutor                 | Ask “How does cosine similarity rank embedding vectors?” Point out the streamed response and click its source chip to jump to the exact section. “This run uses the extractive SAMPLE provider; Gemini is configurable separately.” |
| 1:10–1:55 | Practice quiz → Get a hint → choose an answer | “The hint asks a guiding question without showing the solution. Each graded question is recorded once and updates mastery.” Try an incorrect answer to illustrate adaptive planning.                                                |
| 1:55–2:35 | Study plan → Generate study plan              | “The learner’s time and recent quiz results shape the next week. The server rejects unknown lesson IDs and plans over budget.” Show the dated entries and linked lessons.                                                           |
| 2:35–3:00 | Overview → Weekly recap → Generate            | “The recap is based on persisted learning events. The public demonstration does not have admin access or any real organization records.”                                                                                            |

**If asked about onboarding:** Sign out, choose Create account, use a made-up email, and fill the learning profile. Reload to show persistence. The simulated Google button is available in demo mode; hosted Google OAuth must be configured separately.

**If asked about admin:** In a private local emulator, grant an admin claim to a separate test account with `npm run admin:grant -- <account-email>`, sign back in, and open `/admin`. Use `SAMPLE_generative_ai.json` for a safe same-revision import. Public preview deliberately refuses admin actions. Do not use production credentials in a public demo.
