import { authenticated, HttpError, json, readJson } from "@/lib/http";
import { takeAiQuota } from "@/lib/limits";
import { createPlan, planContext } from "@/lib/plan";
import { planInputSchema, planSchema } from "@/lib/schemas";
export const maxDuration = 45;
export const GET = authenticated(async (_request, claims) =>
  json((await planContext(claims.uid)).status),
);
export const POST = authenticated(async (request, claims) => {
  const input = await readJson(request, planInputSchema);
  if (input.uid !== claims.uid)
    throw new HttpError(
      403,
      "FORBIDDEN",
      "You can only plan for your own account.",
    );
  const context = await planContext(claims.uid);
  if (context.status.plan && !context.status.reason && !input.refresh)
    return json(planSchema.parse({ days: context.status.plan.days }));
  await takeAiQuota(claims.uid);
  return json(await createPlan(claims.uid, context, request.signal));
});
