/** One org membership from the caller's own point of view. */
export type Membership = {
  orgId: string;
  orgName: string;
  role: "org_admin" | "member";
  status: "pending" | "active" | "rejected";
};

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
  /** Platform roles (e.g. "super_admin"); orthogonal to org roles. */
  roles: string[];
  /** The single org this session is bound to, or null when unscoped. */
  activeOrg: Membership | null;
  /** Every org the user belongs to, in any status. */
  memberships: Membership[];
};

export type AuthSession = {
  accessToken: string;
  expiresAt: string;
  user: AuthUser;
};

const LEGACY_ACCESS_TOKEN_KEY = "platform.access_token";
const LEGACY_EXPIRES_AT_KEY = "platform.access_token_expires_at";
const USER_KEY = "platform.user";

let accessToken: string | null = null;
let expiresAt: string | null = null;
let currentUser = readJSON<AuthUser>(USER_KEY);

export function syncSessionFromStorage(): void {
  purgeLegacyTokenKeys();
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

const SESSION_EVENT = "api:session";

function notifySessionChange(user: AuthUser | null): void {
  try {
    globalThis.dispatchEvent(
      new CustomEvent(SESSION_EVENT, { detail: { user } }),
    );
  } catch {}
}

export function onSessionChange(
  handler: (user: AuthUser | null) => void,
): () => void {
  const listener = (event: Event) => {
    const user =
      (event as CustomEvent<{ user: AuthUser | null }>).detail?.user ?? null;
    handler(user);
  };
  globalThis.addEventListener(SESSION_EVENT, listener);
  return () => globalThis.removeEventListener(SESSION_EVENT, listener);
}

export function commitSession(session: AuthSession): AuthSession {
  accessToken = session.accessToken;
  expiresAt = session.expiresAt;
  currentUser = session.user;
  writeStorage(USER_KEY, JSON.stringify(currentUser));
  notifySessionChange(currentUser);
  return session;
}

export function clearSession(): void {
  accessToken = null;
  expiresAt = null;
  currentUser = null;
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

function readJSON<T>(key: string): T | null {
  const raw = readStorage(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
