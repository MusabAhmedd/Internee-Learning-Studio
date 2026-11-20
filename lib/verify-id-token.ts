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
  console.error(
    JSON.stringify({ event: "fetching_google_keys", url: KEYS_URL }),
  );
  const res = await fetch(KEYS_URL, { cache: "no-store" });
  if (!res.ok) {
    console.error(
      JSON.stringify({
        event: "google_keys_fetch_failed",
        status: res.status,
      }),
    );
    throw new Error("Failed to fetch Google public keys");
  }
  const keys: Record<string, string> = await res.json();
  console.error(
    JSON.stringify({
      event: "google_keys_fetched",
      keyCount: Object.keys(keys).length,
      kids: Object.keys(keys),
    }),
  );
  keysCache = { keys, fetchedAt: now };
  return keys;
}

function decodeJwtSegment<T = Record<string, unknown>>(segment: string): T {
  const decoded = Buffer.from(segment, "base64url").toString("utf-8");
  try {
    return JSON.parse(decoded) as T;
  } catch {
    console.error(
      JSON.stringify({
        event: "jwt_segment_decode_failed",
        segmentLength: segment.length,
        firstChars: decoded.slice(0, 120),
      }),
    );
    throw new Error("JWT segment decode failed");
  }
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
    header = decodeJwtSegment(headerB64);
  } catch {
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid session token header.",
    );
  }
  if (header.alg !== "RS256" || !header.kid)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Unsupported token algorithm.",
    );

  console.error(
    JSON.stringify({ event: "looking_up_key", kid: header.kid }),
  );
  const keys = await fetchKeys();
  const cert = keys[header.kid];
  if (!cert) {
    console.error(
      JSON.stringify({
        event: "token_verify_failed",
        reason: "unknown_kid",
        kid: header.kid,
        availableKids: Object.keys(keys),
      }),
    );
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Unknown token signing key.",
    );
  }

  let publicKey;
  try {
    publicKey = createPublicKey({ key: cert, format: "pem" });
    console.error(
      JSON.stringify({ event: "public_key_created", type: publicKey.type }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "public_key_creation_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token signing key format.",
    );
  }

  const data = `${headerB64}.${payloadB64}`;
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureB64, "base64url");
  } catch {
    console.error(
      JSON.stringify({
        event: "token_verify_failed",
        reason: "signature_base64_failed",
        signatureLength: signatureB64.length,
      }),
    );
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token signature encoding.",
    );
  }

  let valid = false;
  try {
    valid = verify(
      "RSA-SHA256",
      Buffer.from(data, "utf-8"),
      publicKey,
      signature,
    );
    console.error(
      JSON.stringify({ event: "signature_verification", valid }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "signature_verification_error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    valid = false;
  }
  if (!valid) {
    console.error(
      JSON.stringify({
        event: "token_verify_failed",
        reason: "invalid_signature",
      }),
    );
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token signature.",
    );
  }

  let claims: Record<string, unknown>;
  try {
    claims = decodeJwtSegment(payloadB64);
  } catch {
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token payload.",
    );
  }

  if (claims.iss !== `${ISSUER}/${projectId}`) {
    console.error(
      JSON.stringify({
        event: "token_verify_failed",
        reason: "invalid_issuer",
        expected: `${ISSUER}/${projectId}`,
        actual: claims.iss,
      }),
    );
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token issuer.",
    );
  }
  if (claims.aud !== projectId) {
    console.error(
      JSON.stringify({
        event: "token_verify_failed",
        reason: "invalid_audience",
        expected: projectId,
        actual: claims.aud,
      }),
    );
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token audience.",
    );
  }
  const exp = Number(claims.exp);
  const iat = Number(claims.iat);
  const now = Math.floor(Date.now() / 1000);
  if (!exp || exp <= now) {
    console.error(
      JSON.stringify({
        event: "token_verify_failed",
        reason: "token_expired",
        exp,
        now,
      }),
    );
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Token expired.",
    );
  }
  if (!iat || iat > now + 60) {
    console.error(
      JSON.stringify({
        event: "token_verify_failed",
        reason: "invalid_iat",
        iat,
        now,
      }),
    );
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid token issued at.",
    );
  }

  console.error(
    JSON.stringify({
      event: "token_verified",
      uid: claims.sub,
      email: claims.email,
    }),
  );

  return {
    uid: String(claims.sub ?? ""),
    email: claims.email ? String(claims.email) : undefined,
    admin: claims.admin === true,
    auth_time: Number(claims.auth_time) || 0,
  };
}
