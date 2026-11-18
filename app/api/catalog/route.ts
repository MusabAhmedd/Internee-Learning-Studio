import { listCatalog } from "@/lib/catalog";
import { authenticated, json } from "@/lib/http";
export const GET = authenticated(async () => json(await listCatalog()));
