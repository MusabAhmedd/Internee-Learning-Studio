# Hosted staging verification

Run these against a staging project and repository you are authorized to use, with disposable learner/admin accounts and authorized curriculum. Record the commit, environment, commands, status, and redacted output for each gate. Keep keys and tokens in the host's secret store or a private local environment; never share them in chat, source, screenshots, command output, or ZIPs.

| Gate                                     | What to verify                                                                                                                                                                                                                           | Status in this review                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Docker and Compose                       | Build the standalone image, wait for container health, check non-root UID, and verify `GET /api/health` and unauthenticated denial                                                                                                       | **DONE** locally, public placeholders only. `docs/eval/REVIEW-8.txt`             |
| Firebase Auth / Firestore / Storage      | Deploy checked-in rules and indexes to the intended staging project; test account/profile persistence, owner-only reads, denied browser writes, and private admin upload                                                                 | **NOT RUN** hosted. Equivalent rules and application workflows ran on emulators. |
| Real Google OAuth                        | Follow the [Firebase Google provider setup](https://firebase.google.com/docs/auth/web/google-signin). Allowlist the staging host, sign in in a top-level tab with a test Google account, reload, verify the saved profile, and sign out. | **NOT RUN**. A Firebase Auth Emulator popup is not Google OAuth.                 |
| Live Gemini                              | Run `npm run verify:gemini` in the keyless Firebase setup with an authorized Gemini key. Save availability, status, latency and any reported token counts. Run the independent review before learner rollout.                            | **NOT RUN** provider calls. Missing-key guard verified.                          |
| Hosted App Check, edge IP and monitoring | Complete `docs/ABUSE_CONTROLS.md`; confirm genuine and absent/invalid app attestation, staged WAF enforcement, and alert delivery.                                                                                                       | **NOT RUN** hosted.                                                              |
| Vercel                                   | Build the intended staging commit with Node 24.x and hosted env values. Probe health, then repeat Firebase, OAuth, App Check and all five model workflows.                                                                               | **NOT RUN**. No connected or authorized staging project.                         |
| Remote GitHub Actions                    | Push the intended commit to the authorized repo/branch. Inspect the `Learning Studio CI` run for that commit, required checks, tests and audit. Save its URL and result.                                                                 | **NOT RUN**. No authorized remote; the checked-in commands ran locally.          |

## Docker smoke re-run (no cloud credentials)

In a disposable extraction, create an ignored `.env.local` using **placeholder** values for `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, and `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`; use `NEXT_PUBLIC_DEMO_MODE=0`, `APP_CHECK_MODE=required`, `AI_PROVIDER=gemini`, and dummy `FIREBASE_PROJECT_ID`/`FIREBASE_STORAGE_BUCKET`. Do not add emulator hosts, Gemini keys, or Firebase credentials for this smoke. Run these in the extraction, not over a real deployment:

```bash
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local build
docker compose --env-file .env.local up --wait --wait-timeout 80 --no-build
curl -fsS http://127.0.0.1:3000/api/health
# Expected HTTP 401, no Firebase or Gemini call:
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/profile
docker compose --env-file .env.local down
```

The health endpoint is liveness only. Docker health does not prove downstream integration, real browser sign-in, or production deployment.
