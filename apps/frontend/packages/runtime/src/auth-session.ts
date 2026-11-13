/** Host-owned authentication capability. Runtime carries the binding, never credentials. */
export interface PlatformAuth {
  getAccessToken(): string | null;
  isAccessTokenValid(): boolean;
  refreshAccessToken(): Promise<boolean>;
  logout(): Promise<void>;
  switchWorkspace(workspaceId: string): Promise<void>;
}

let platformAuth: PlatformAuth | null = null;

export function registerPlatformAuth(auth: PlatformAuth): void {
  platformAuth = auth;
}

export function getPlatformAuth(): PlatformAuth | null {
  return platformAuth;
}
