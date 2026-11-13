export interface StoredAuthUser {
  id: string;
}

export interface StoredAuthSession {
  accessToken: string;
  expiresAt: string;
  user: StoredAuthUser;
}

const LEGACY_ACCESS_TOKEN_KEY = "platform.access_token";
const LEGACY_EXPIRES_AT_KEY = "platform.access_token_expires_at";
const USER_KEY = "platform.user";

let accessToken: string | null = null;
let expiresAt: string | null = null;
let currentUserStorage = readStorage(USER_KEY);
let currentUser = parseJSON<StoredAuthUser>(currentUserStorage);

export function syncSessionFromStorage(): void {
  purgeLegacyTokenKeys();
  const storedUser = readStorage(USER_KEY);
  if (storedUser === currentUserStorage) {
    return;
  }
  currentUserStorage = storedUser;
  currentUser = parseJSON<StoredAuthUser>(storedUser);
}

export function getToken(): string | null {
  return accessToken;
}

export function getCurrentUser<T extends StoredAuthUser = StoredAuthUser>(): T | null {
  return currentUser as T | null;
}

export function isAccessTokenValid(): boolean {
  if (!accessToken || !expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() > Date.now() + 30_000;
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
  accessToken = session.accessToken;
  expiresAt = session.expiresAt;
  currentUser = session.user;
  currentUserStorage = JSON.stringify(currentUser);
  writeStorage(USER_KEY, currentUserStorage);
  notifySessionChange(currentUser);
  return session;
}

export function clearSession(): void {
  accessToken = null;
  expiresAt = null;
  currentUser = null;
  currentUserStorage = null;
  purgeLegacyTokenKeys();
  writeStorage(USER_KEY, null);
  notifySessionChange(null);
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
