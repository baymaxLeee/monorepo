import { randomId } from "@repo/shared";

const DEVICE_ID_KEY = "platform.obs.device_id";
const SESSION_ID_KEY = "platform.obs.session_id";
const SESSION_SEEN_AT_KEY = "platform.obs.session_seen_at";
const SESSION_TTL_MS = 30 * 60 * 1000;

export function getDeviceId(): string {
  return getOrCreateStorageId(localStorage, DEVICE_ID_KEY);
}

export function getSessionId(): string {
  const now = Date.now();
  const seenAt = Number(sessionStorage.getItem(SESSION_SEEN_AT_KEY) ?? 0);
  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
  if (!sessionId || !Number.isFinite(seenAt) || now - seenAt > SESSION_TTL_MS) {
    sessionId = randomId();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  }
  sessionStorage.setItem(SESSION_SEEN_AT_KEY, String(now));
  return sessionId;
}

function getOrCreateStorageId(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) {
    return existing;
  }
  const next = randomId();
  storage.setItem(key, next);
  return next;
}
