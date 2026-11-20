import { createPublicKey, verify } from "node:crypto";
import { HttpError } from "./http-error";

const KEYS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const ISSUER = "https://securetoken.google.com";
const KEYS_TTL_MS = 60 * 60 * 1000;

let keysCache:
  | { keys: Record<string, string>; fetchedAt: number }
  | null = null;

async function fetchKeys() {
  const now = Date.now();
  if (keysCache && now - keysCache.fetchedAt < KEYS_TTL_MS)
    return keysCache.keys;
  const res = await fetch(KEYS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch Google public keys");
  const keys: Record<string, string> = await res.json();
  keysCache = { keys, fetchedAt: now };
  return keys;
}

function decodeJwt<T = Record<string, unknown>>(token: string): T {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("Invalid JWT");
  const decoded = Buffer.from(payload, "base64url").toString("utf-8");
  return JSON.parse(decoded) as T;
}

export type FirebaseIdTokenClaims = {
  uid: string;
  email?: string;
  admin: boolean;
  auth_time: number;
};

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
): Promise<FirebaseIdTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid session token.",
    );
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string; typ?: string };
  try {
    header = JSON.parse(
      Buffer.from(headerB64, "base64url").toString("utf-8"),
    );
  } catch {
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid session token.",
    );
  }
  if (header.alg !== "RS256" || !header.kid)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Unsupported token algorithm.",
    );

  const keys = await fetchKeys();
  const cert = keys[header.kid];
  if (!cert)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Unknown token signing key.",
    );

  const publicKey = createPublicKey({ key: cert, format: "pem" });

  const data = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(signatureB64, "base64url");

  let valid = false;
  try {
    valid = verify(
      "RSA-SHA256",
      Buffer.from(data, "utf-8"),
      publicKey,
      signature,
    );
  } catch {
    valid = false;
  }
  if (!valid)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token signature.",
    );

  let claims: Record<string, unknown>;
  try {
    claims = decodeJwt(payloadB64);
  } catch {
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token payload.",
    );
  }

  if (claims.iss !== `${ISSUER}/${projectId}`)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token issuer.",
    );
  if (claims.aud !== projectId)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token audience.",
    );
  const exp = Number(claims.exp);
  const iat = Number(claims.iat);
  const now = Math.floor(Date.now() / 1000);
  if (!exp || exp <= now)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Token expired.",
    );
  if (!iat || iat > now + 60)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token issued at.",
    );

  return {
    uid: String(claims.sub ?? ""),
    email: claims.email ? String(claims.email) : undefined,
    admin: claims.admin === true,
    auth_time: Number(claims.auth_time) || 0,
  };
}
