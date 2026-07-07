import { request, setRefreshAccessToken } from "./http";
import {
  type AuthSession,
  type AuthUser,
  clearSession,
  commitSession,
  getCurrentUser,
  getToken,
  isAccessTokenValid,
  type Membership,
  syncSessionFromStorage,
} from "./storage";

export type { AuthSession, AuthUser, Membership } from "./storage";

export type AuthCredentials = {
  account: string;
  password: string;
};

export type RegisterInput = AuthCredentials & {
  /** Optional additional org application; guest-org membership is automatic. */
  orgId?: string;
  avatarUrl?: string;
  email?: string;
  displayName?: string;
  locale?: string;
  phoneNumber?: string;
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

export async function checkAccountAvailability(account: string): Promise<{
  account: string;
  available: boolean;
}> {
  return request({
    url: "/api/iam-server/account-availability",
    method: "GET",
    params: { account },
    skipErrorNotify: true,
  });
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
    skipErrorNotify: true,
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

/** Current identity, reflecting the latest roles + memberships + activeOrg.
 * The waiting page polls this to observe an approval landing. */
export async function fetchMe(): Promise<AuthUser> {
  return request<AuthUser>({ url: "/api/iam-server/me", method: "GET" });
}

export async function fetchMemberships(): Promise<Membership[]> {
  return request<Membership[]>({
    url: "/api/iam-server/me/memberships",
    method: "GET",
  });
}

/** Bind the session to a different active org (must be an active membership).
 * Rotates the refresh token and returns a freshly scoped session. */
export async function switchActiveOrg(orgId: string): Promise<AuthSession> {
  return commitSession(
    await request<AuthSession>({
      url: "/api/iam-server/session/active-org",
      method: "POST",
      data: { orgId },
    }),
  );
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
