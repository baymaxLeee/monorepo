import {
  type AuthSession,
  type AuthUser,
  login as loginRequest,
  logout as logoutRequest,
  refreshSession as refreshSessionRequest,
  register as registerRequest,
  switchActiveWorkspace as switchActiveWorkspaceRequest,
  type LoginInput,
  type Membership,
  type RegisterInput,
} from "@repo/api/iam";
import { registerPlatformAuth } from "@repo/runtime";
import { getDesktopBridge } from "@repo/runtime/desktop";

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
  return onTransportSessionChange(handler);
}

export async function register(input: RegisterInput): Promise<AuthSession> {
  return commitSession(await registerRequest(input));
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

let refreshPromise: Promise<AuthSession | null> | null = null;

export async function refreshSession(): Promise<AuthSession | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const desktop = getDesktopBridge();
    // Native refresh remains the owner when running in the desktop host.
    try {
      const session = desktop
        ? ((await desktop.refreshSession()) as AuthSession)
        : await refreshSessionRequest({ skipErrorNotify: true });
      return commitSession(session);
    } catch {
      clearSession();
      return null;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/** Bind the session to a different active workspace (must be an active membership).
 * Rotates the refresh token and returns a freshly scoped session. */
export async function switchActiveWorkspace({ workspaceId }: { workspaceId: string }): Promise<AuthSession> {
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

registerPlatformAuth({
  getAccessToken: getToken,
  isAccessTokenValid,
  refreshAccessToken: async () => Boolean(await refreshSession()),
  logout,
  switchWorkspace: async (workspaceId) => {
    await switchActiveWorkspace({ workspaceId });
  },
});
