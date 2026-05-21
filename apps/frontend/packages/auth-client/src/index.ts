/**
 * Stub auth client. Real implementation would handle JWT, refresh, etc.
 */

let token: string | null = null;

export function setToken(t: string | null): void {
  token = t;
}

export function getToken(): string | null {
  return token;
}

export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
