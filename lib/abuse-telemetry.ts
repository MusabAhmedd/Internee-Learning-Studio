// Only static event names/statuses. Never pass a request, request ID, IP, token, or learner data.
export function abuseEvent(
  event: "account_signal" | "rate_limited" | "admin_import",
  code: string,
) {
  console.info(JSON.stringify({ event, code }));
}
