export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  locale: string;
  timezone: string;
  theme: "system" | "light" | "dark" | string;
  marketingOptIn: boolean;
  emailVerified: boolean;
};

export type AuthSession = {
  accessToken: string;
  expiresAt: string;
  user: AuthUser;
};

export type AuthCredentials = {
  email: string;
  password: string;
};

export type RegisterInput = AuthCredentials & {
  displayName?: string;
  locale?: string;
  timezone?: string;
};

const ACCESS_TOKEN_KEY = "platform.access_token";
const EXPIRES_AT_KEY = "platform.access_token_expires_at";
const USER_KEY = "platform.user";

let accessToken = readStorage(ACCESS_TOKEN_KEY);
let expiresAt = readStorage(EXPIRES_AT_KEY);
let currentUser = readJSON<AuthUser>(USER_KEY);
let refreshPromise: Promise<AuthSession | null> | null = null;

export function getToken(): string | null {
  return accessToken;
}

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

export function setToken(token: string | null): void {
  accessToken = token;
  writeStorage(ACCESS_TOKEN_KEY, token);
}

export function authHeaders(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export async function register(input: RegisterInput): Promise<AuthSession> {
  return commitSession(await request<AuthSession>("/v1/auth/register", input));
}

export async function login(input: AuthCredentials): Promise<AuthSession> {
  return commitSession(await request<AuthSession>("/v1/auth/login", input));
}

export async function logout(): Promise<void> {
  try {
    await fetch(apiURL("/v1/auth/logout"), {
      method: "POST",
      credentials: "include",
    });
  } finally {
    clearSession();
  }
}

export async function refreshSession(): Promise<AuthSession | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = request<AuthSession>("/v1/auth/refresh", undefined)
    .then(commitSession)
    .catch(() => {
      clearSession();
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export async function bootstrapSession(): Promise<AuthUser | null> {
  if (
    accessToken &&
    expiresAt &&
    new Date(expiresAt).getTime() > Date.now() + 30_000
  ) {
    return currentUser;
  }
  const refreshed = await refreshSession();
  return refreshed?.user ?? null;
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetchWithAuth(input, init);
  if (response.status !== 401) {
    return response;
  }
  const refreshed = await refreshSession();
  if (!refreshed) {
    return response;
  }
  return fetchWithAuth(input, init);
}

function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiURL(path), {
    method: "POST",
    credentials: "include",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await problemDetail(response);
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function commitSession(session: AuthSession): AuthSession {
  accessToken = session.accessToken;
  expiresAt = session.expiresAt;
  currentUser = session.user;
  writeStorage(ACCESS_TOKEN_KEY, accessToken);
  writeStorage(EXPIRES_AT_KEY, expiresAt);
  writeStorage(USER_KEY, JSON.stringify(currentUser));
  return session;
}

function clearSession(): void {
  accessToken = null;
  expiresAt = null;
  currentUser = null;
  writeStorage(ACCESS_TOKEN_KEY, null);
  writeStorage(EXPIRES_AT_KEY, null);
  writeStorage(USER_KEY, null);
}

async function problemDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string; title?: string };
    return body.detail ?? body.title ?? `Request failed: ${response.status}`;
  } catch {
    return `Request failed: ${response.status}`;
  }
}

function apiURL(path: string): string {
  const globals = globalThis as {
    __API_BASE_URL__?: string;
    __API_BASE__?: string;
  };
  const base =
    globals.__API_BASE_URL__ ?? globals.__API_BASE__ ?? "http://localhost:8000";
  return `${base}${path}`;
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
