import { z } from "zod";
import { authenticated, json, readJson } from "@/lib/http";
import { summaryFor, writeSummary } from "@/lib/summary";
import { summaryResponseSchema } from "@/lib/schemas";
export const maxDuration = 45;
export const GET = authenticated(async (_request, claims) =>
  json(summaryResponseSchema.parse({ summary: await summaryFor(claims.uid) })),
);
export const POST = authenticated(async (request, claims) => {
  await readJson(request, z.strictObject({}));
  return json(await writeSummary(claims.uid, request.signal));
});
