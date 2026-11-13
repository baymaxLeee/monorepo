import type { AuthSession, AuthUser } from "@repo/api/iam";
import { getDesktopBridge } from "@repo/runtime/desktop";

type StoredAuthSession = AuthSession;
type StoredAuthUser = AuthUser;
const sessionState = {
  accessToken: null as string | null,
  expiresAt: null as string | null,
  currentUserStorage: null as string | null,
  currentUser: null as AuthUser | null,
};

const LEGACY_ACCESS_TOKEN_KEY = "platform.access_token";
const LEGACY_EXPIRES_AT_KEY = "platform.access_token_expires_at";
const USER_KEY = "platform.user";

export function syncSessionFromStorage(): void {
  purgeLegacyTokenKeys();
  const storedUser = readStorage(USER_KEY);
  if (storedUser === sessionState.currentUserStorage) {
    return;
  }
  sessionState.currentUserStorage = storedUser;
  sessionState.currentUser = parseJSON<StoredAuthUser>(storedUser);
}

export function getToken(): string | null {
  return sessionState.accessToken;
}

export function getCurrentUser<T extends StoredAuthUser = StoredAuthUser>(): T | null {
  return sessionState.currentUser as T | null;
}

export function isAccessTokenValid(): boolean {
  if (!sessionState.accessToken || !sessionState.expiresAt) {
    return false;
  }
  return new Date(sessionState.expiresAt).getTime() > Date.now() + 30_000;
}

const SESSION_EVENT = "api:session";

function notifySessionChange(user: StoredAuthUser | null): void {
  try {
    globalThis.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { user } }));
  } catch {}
}

export function onSessionChange(handler: (user: StoredAuthUser | null) => void): () => void {
  const listener = (event: Event) => {
    const user = (event as CustomEvent<{ user: StoredAuthUser | null }>).detail?.user ?? null;
    handler(user);
  };
  globalThis.addEventListener(SESSION_EVENT, listener);
  return () => globalThis.removeEventListener(SESSION_EVENT, listener);
}

export function commitSession<T extends StoredAuthSession>(session: T): T {
  sessionState.accessToken = session.accessToken;
  sessionState.expiresAt = session.expiresAt;
  sessionState.currentUser = session.user;
  sessionState.currentUserStorage = JSON.stringify(sessionState.currentUser);
  writeStorage(USER_KEY, sessionState.currentUserStorage);
  notifySessionChange(sessionState.currentUser);
  void getDesktopBridge()
    ?.bindSession(session.accessToken, session.expiresAt)
    .catch(() => {
      // The native host retains the failed binding result and rejects local
      // operations. Web authentication remains usable for cloud conversations.
    });
  return session;
}

export function clearSession(): void {
  sessionState.accessToken = null;
  sessionState.expiresAt = null;
  sessionState.currentUser = null;
  sessionState.currentUserStorage = null;
  purgeLegacyTokenKeys();
  writeStorage(USER_KEY, null);
  notifySessionChange(null);
  void getDesktopBridge()
    ?.clearSession()
    .catch(() => undefined);
}

function purgeLegacyTokenKeys(): void {
  writeStorage(LEGACY_ACCESS_TOKEN_KEY, null);
  writeStorage(LEGACY_EXPIRES_AT_KEY, null);
}

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      globalThis.localStorage?.removeItem(key);
    } else {
      globalThis.localStorage?.setItem(key, value);
    }
  } catch {}
}

function parseJSON<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
