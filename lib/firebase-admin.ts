import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export function isDemo() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "1";
}

function app(): App {
  if (typeof window !== "undefined")
    throw new Error("Admin SDK is server-only.");
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
  const demo = isDemo();
  const emulatorHosts = [
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
    process.env.FIRESTORE_EMULATOR_HOST,
    process.env.FIREBASE_STORAGE_EMULATOR_HOST,
  ];
  if (
    !projectId ||
    !storageBucket ||
    (demo &&
      (!projectId.startsWith("demo-") || !emulatorHosts.every(Boolean))) ||
    (!demo && (projectId.startsWith("demo-") || emulatorHosts.some(Boolean)))
  ) {
    throw new Error("Invalid Firebase server configuration.");
  }
  const existing = getApps().find((item) => item.name === "[DEFAULT]");
  if (existing) return existing;
  if (demo) return initializeApp({ projectId, storageBucket });
  const email = process.env.FIREBASE_CLIENT_EMAIL;
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (Boolean(email) !== Boolean(key))
    throw new Error("Incomplete Firebase service account configuration.");
  const credential =
    email && key
      ? cert({
          projectId,
          clientEmail: email,
          privateKey: key.replace(/\\n/g, "\n"),
        })
      : applicationDefault();
  return initializeApp({ projectId, storageBucket, credential });
}

export const adminAuth = () => getAuth(app());
export const adminAppCheck = () => getAppCheck(app());
export const db = () => getFirestore(app());
export const bucket = () => getStorage(app()).bucket();
