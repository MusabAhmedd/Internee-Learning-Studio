import { dashboardFor } from "@/lib/dashboard";
import { authenticated, json } from "@/lib/http";
export const GET = authenticated(async (_request, claims) =>
  json((await dashboardFor(claims.uid)).board),
);
