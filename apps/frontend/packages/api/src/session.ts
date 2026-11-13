import { setRefreshAccessToken } from "./http";
import {
  type AuthSession,
  type AuthUser,
  checkAccountAvailability as checkAccountAvailabilityRequest,
  fetchMe as fetchMeRequest,
  fetchMemberships as fetchMembershipsRequest,
  login as loginRequest,
  logout as logoutRequest,
  refreshSession as refreshSessionRequest,
  register as registerRequest,
  switchActiveWorkspace as switchActiveWorkspaceRequest,
  type LoginInput,
  type Membership,
  type RegisterInput,
} from "./iam-server";
import {
  clearSession,
  commitSession,
  getCurrentUser,
  getToken,
  isAccessTokenValid,
  onSessionChange as onTransportSessionChange,
  syncSessionFromStorage,
} from "./storage";

export type { AuthSession, AuthUser, LoginInput as AuthCredentials, Membership, RegisterInput };
export function onSessionChange(handler: (user: AuthUser | null) => void): () => void {
  return onTransportSessionChange((user) => handler(user as AuthUser | null));
}

let refreshPromise: Promise<AuthSession | null> | null = null;

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function register(input: RegisterInput): Promise<AuthSession> {
  return commitSession(await registerRequest(input));
}

export async function checkAccountAvailability(account: string): Promise<{
  account: string;
  available: boolean;
}> {
  return checkAccountAvailabilityRequest({ account }, { skipErrorNotify: true });
}

export async function login(input: LoginInput): Promise<AuthSession> {
  return commitSession(await loginRequest(input));
}

export async function logout(): Promise<void> {
  try {
    await logoutRequest();
  } finally {
    clearSession();
  }
}

export async function refreshSession(): Promise<AuthSession | null> {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = refreshSessionRequest({ skipErrorNotify: true })
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

/** Current identity, reflecting the latest roles + memberships + activeWorkspace.
 * The waiting page polls this to observe an approval landing. */
export async function fetchMe(): Promise<AuthUser> {
  return fetchMeRequest();
}

export async function fetchMemberships(): Promise<Membership[]> {
  return fetchMembershipsRequest();
}

/** Bind the session to a different active workspace (must be an active membership).
 * Rotates the refresh token and returns a freshly scoped session. */
export async function switchActiveWorkspace(workspaceId: string): Promise<AuthSession> {
  return commitSession(await switchActiveWorkspaceRequest({ workspaceId }));
}

export async function bootstrapSession(): Promise<AuthUser | null> {
  syncSessionFromStorage();

  if (isAccessTokenValid() && getCurrentUser<AuthUser>()) {
    return getCurrentUser<AuthUser>();
  }

  const refreshed = await refreshSession();
  return refreshed?.user ?? null;
}

setRefreshAccessToken(async () => Boolean(await refreshSession()));
