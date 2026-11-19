# Review corrections

## 1. Separate provider usage from API protection

The original tutor, quiz, planning, recap, and curriculum upload paths charged a shared AI budget before they knew whether they needed a model. In Gemini mode a nominally fixed hint also called Gemini for its retrieval embedding.

- `lib/limits.ts` separates per-action API counters from `providerLimits`. The import lane has its own ceiling. Legacy `aiLimits` rows are not read or carried over, so deterministic usage is not counted against the new ledger.
- `lib/openai.ts` admits a request after provider/model configuration is validated and immediately before a remote attempt. A memoized per-request admission covers both query embedding and chat. Local demo work, cache hits that skip Gemini, deterministic grading, fixed hints, and imports do not spend AI allowance. A remote attempt, including a provider error or SDK retry, is charged as one learner request, not per SDK request.
- `lib/tutor.ts` matches hint sources against canonical lesson text locally. Hint mode has its own API lane in `app/api/tutor/route.ts`. The quiz, plan, and summary services pass admission only to the executed model call.
- `tests/limits.test.ts` checks lazy/coalesced admission and no provider dependency for fixed hints. `tests/api.test.ts` checks that saturated provider counters are unchanged by hints, MCQs and admin uploads, and that the independent API/admin caps still reject requests.

## 2. Real Gemini verification

Demo success did not demonstrate Gemini compatibility or provider performance. The preflight in `scripts/verify-gemini.mjs` refuses to proceed without configured model IDs, an authorized key, a built app, and the SAMPLE Firebase project. `scripts/ci-integration.mjs` provisions fresh local emulators. `scripts/gemini-probe.ts` exercises embeddings (via `embed --verify`), streaming tutoring, mixed quiz generation, rubric-based grading with a persisted attempt, constrained plans, and recaps with cache reuse. The provider logs in `lib/openai.ts` report status, latency, usage when returned, and whether an upstream SDK call was attempted. They omit prompts, secrets, and learner data.

This sandbox had no authorized key. The no-key guard is tested, but real provider calls, failure rates, token counts, and latency are **NOT RUN**. A local demo regression is not a substitute. Run `npm run verify:gemini` after configuring an authorized key outside version control.

## 3. Visible study time

`components/complete-lesson.tsx` used to send one self-reported duration at completion and lose time on navigation. It now sends server-clock-anchored visible windows every 15 seconds and flushes on hide, `pagehide`, navigation, and completion. `lib/client-api.ts` primes auth headers so small keepalive flushes do not first have to refresh a token.

`lib/study-time.ts`, `lib/progress-store.ts`, `lib/schemas.ts`, and `app/api/progress/route.ts` cap each reported window at 30 seconds, reject stale/future reports, and transactionally cap each lesson at its published estimate (at most two hours). A learner-wide high-water timestamp prevents overlap and replay across tabs and lessons. Late, out-of-order portions behind that timestamp are deliberately not credited. Browser exit and offline delivery are best effort; these records are not proof of attendance. Legacy completion documents remain readable. Dashboard time includes incomplete lessons, while certificates, badges, progress counts, and plan completion still require an explicit completion timestamp.

## 4. Tutor quality beyond citation IDs

`data/sample/SAMPLE_tutor_quality_eval.json` and `scripts/eval-tutor-quality.ts` now exercise harder multi-section cases, direct/delimited user injection, role and indirect source injection, and false/conflicting sources. `lib/tutor.ts` rejects obvious embedded role commands, and `prompts/tutor.v2.md` asks for synthesis and abstention when sources conflict. Neither change proves factual correctness or general prompt-injection resistance.

The local run is in `docs/eval/REVIEW-4.txt` and `docs/eval/REVIEW-4-quality-sample.json`. The narrow safety gate passed. The diagnostic suite found missing sections, an indirect marker echoed in a quoted source, and unsupported/conflicting synthetic arithmetic. In particular, the tutor cited the intended section but echoed “nine plus seven equals eighteen.” The correct value is sixteen. These failures remain visible; the evaluation is not a rollout approval.

`scripts/score-tutor-review.ts` and `docs/TUTOR_REVIEW.md` add a separate human review workflow for claim-level factual accuracy and citation entailment. A scorer fixture verified that a claim can be both incorrect and textually entailed. Actual independent human and live-provider results are **NOT RUN**.

## 5. Learner-local day boundaries

`app/onboarding/page.tsx` and `app/api/profile/route.ts` persist an editable IANA time zone. Legacy profiles default to UTC and partial compatibility inputs preserve the previously saved zone. `lib/learning-dates.ts` projects UTC instants to learner dates, then adds/subtracts calendar days without assuming 24-hour local days.

`lib/plan.ts` and `lib/plan-validation.ts` use one learner-local date snapshot for each plan. `lib/dashboard.ts` computes the streak from local activity days, and `lib/summary.ts` filters the seven local dates and invalidates cached recaps from a different window. Display dates in the dashboard, study plan, recap, and certificate use the same profile setting. Timestamps and operational quota windows remain UTC. Tests cover 19:00 UTC / midnight PKT, daylight-saving transitions, the new-year boundary, timezone persistence, plan lag, and recap cache rollover.

## 6. Abuse protection across accounts and at the hosting edge

`lib/limits.ts` now atomically enforces project-wide Gemini and admin-upload ceilings as well as individual limits. An account cannot evade a shared budget by creating a new user. Admin uploads never spend Gemini allowance. `lib/app-attestation.ts`, the HTTP auth wrapper, and the browser API client add hosted App Check on protected routes, with staging observation and fail-closed enforcement. The public demo's Auth relay uses a bounded instance-local entry/window limit and remains keyless only.

`docs/ABUSE_CONTROLS.md` describes edge IP controls and auth/abuse monitoring without trusting forwarding headers. App logs emit aggregate-safe categories, not identities or tokens. The local gate verifies policy with an injected App Check verifier and shared counters with real emulator transactions. Actual reCAPTCHA attestation, Vercel WAF rules, and production alerting are **NOT RUN** until authorized deployment.

## 7. Release hygiene

`scripts/release.mjs` builds only from a committed Git tree. It checks a source-path allowlist, forbidden filename/directory policy, repository ignore rules, regular-file modes, and common secret patterns. It verifies ZIP integrity and checks every member against the expected path set. The sidecar records the commit, ZIP SHA-256, and every committed file's hash. `.gitignore`, `.dockerignore`, `.prettierignore`, and the CI workflow account for the release artifacts. The exact previous workspace ZIP was also re-inspected, but it cannot establish what was present in a different downloaded copy.

## 8. Deployment verification

Docker Compose was installed in this sandbox for the review. The audited source built with the pinned base image. The container reached healthy with Node 24.22.3 as UID 1000; `/api/health` returned 200, an unauthenticated profile returned 401, and the SAMPLE Auth relay returned 404 with demo disabled. The build used public placeholders and the container did not contact Firebase, Google OAuth, App Check or Gemini (`docs/eval/REVIEW-8.txt`).

Authorized hosted Firebase, real Google OAuth, App Check/WAF/monitoring, Vercel and remote GitHub Actions remain **NOT RUN**. `docs/HOSTED_VERIFICATION.md` separates the local smoke test from the staged evidence to collect. Existing source and dependency pins were retained; there were no npm dependency changes.
