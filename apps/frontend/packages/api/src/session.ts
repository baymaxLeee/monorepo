import { request, setRefreshAccessToken } from "./http";
import {
  clearSession,
  commitSession,
  getCurrentUser,
  getToken,
  isAccessTokenValid,
  syncSessionFromStorage,
  type AuthSession,
  type AuthUser,
} from "./storage";

export type { AuthSession, AuthUser } from "./storage";

export type AuthCredentials = {
  account: string;
  password: string;
};

export type RegisterInput = AuthCredentials & {
  email?: string;
  displayName?: string;
  locale?: string;
  timezone?: string;
};

let refreshPromise: Promise<AuthSession | null> | null = null;

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function register(input: RegisterInput): Promise<AuthSession> {
  return commitSession(
    await request<AuthSession>({
      url: "/api/iam-server/register",
      method: "POST",
      data: input,
    }),
  );
}

export async function login(input: AuthCredentials): Promise<AuthSession> {
  return commitSession(
    await request<AuthSession>({
      url: "/api/iam-server/login",
      method: "POST",
      data: input,
    }),
  );
}

export async function logout(): Promise<void> {
  try {
    await request<{ status: string }>({
      url: "/api/iam-server/logout",
      method: "POST",
    });
  } finally {
    clearSession();
  }
}

export async function refreshSession(): Promise<AuthSession | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = request<AuthSession>({
    url: "/api/iam-server/refresh",
    method: "POST",
  })
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
  syncSessionFromStorage();

  if (isAccessTokenValid() && getCurrentUser()) {
    return getCurrentUser();
  }

  if (isAccessTokenValid() && !getCurrentUser()) {
    clearSession();
    return null;
  }

  if (!getToken()) {
    clearSession();
    return null;
  }

  const refreshed = await refreshSession();
  return refreshed?.user ?? null;
}

setRefreshAccessToken(async () => Boolean(await refreshSession()));
