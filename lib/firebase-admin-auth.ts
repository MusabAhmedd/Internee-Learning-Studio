import { getAuth } from "firebase-admin/auth";
import { app } from "./firebase-admin";

let authApp: ReturnType<typeof getAuth> | null = null;
export function adminAuth() {
  if (!authApp) authApp = getAuth(app());
  return authApp;
}
