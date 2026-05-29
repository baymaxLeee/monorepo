/** Coarse identity class used by the platform shell to gate app visibility. */
export type UserType = "admin" | "normal";

export type AuthUser = {
  id: string;
  account: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  locale: string;
  timezone: string;
  theme: "system" | "light" | "dark" | string;
  marketingOptIn: boolean;
  emailVerified: boolean;
  /** From iam auth response; absent in pre-upgrade cached sessions → treat as "normal". */
  type?: UserType;
};

export type AuthSession = {
  accessToken: string;
  expiresAt: string;
  user: AuthUser;
};

const ACCESS_TOKEN_KEY = "platform.access_token";
const EXPIRES_AT_KEY = "platform.access_token_expires_at";
const USER_KEY = "platform.user";

let accessToken = readStorage(ACCESS_TOKEN_KEY);
let expiresAt = readStorage(EXPIRES_AT_KEY);
let currentUser = readJSON<AuthUser>(USER_KEY);

export function syncSessionFromStorage(): void {
  accessToken = readStorage(ACCESS_TOKEN_KEY);
  expiresAt = readStorage(EXPIRES_AT_KEY);
  currentUser = readJSON<AuthUser>(USER_KEY);
}

export function getToken(): string | null {
  return accessToken;
}

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

export function isAccessTokenValid(): boolean {
  if (!accessToken || !expiresAt) return false;
  return new Date(expiresAt).getTime() > Date.now() + 30_000;
}

export function commitSession(session: AuthSession): AuthSession {
  accessToken = session.accessToken;
  expiresAt = session.expiresAt;
  currentUser = session.user;
  writeStorage(ACCESS_TOKEN_KEY, accessToken);
  writeStorage(EXPIRES_AT_KEY, expiresAt);
  writeStorage(USER_KEY, JSON.stringify(currentUser));
  return session;
}

export function clearSession(): void {
  accessToken = null;
  expiresAt = null;
  currentUser = null;
  writeStorage(ACCESS_TOKEN_KEY, null);
  writeStorage(EXPIRES_AT_KEY, null);
  writeStorage(USER_KEY, null);
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
  } catch {
    // Storage can be disabled in private contexts; keep the in-memory session.
  }
}

function readJSON<T>(key: string): T | null {
  const raw = readStorage(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
