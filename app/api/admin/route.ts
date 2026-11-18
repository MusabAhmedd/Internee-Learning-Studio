import { requireAdmin, readCohort } from "@/lib/admin";
import { authenticated, json } from "@/lib/http";
export const GET = authenticated(async (_request, claims) => {
  await requireAdmin(claims);
  return json(await readCohort());
});
