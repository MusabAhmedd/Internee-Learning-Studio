import { relayAuth } from "@/lib/demo-auth-relay";
export const POST = (request: Request) =>
  relayAuth(request, "/securetoken.googleapis.com/v1/token");
