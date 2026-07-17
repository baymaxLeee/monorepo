import { type AuthUser, bootstrapSession } from "api";
import { type LoaderFunctionArgs, redirect } from "react-router-dom";
import { usePlatformStore } from "runtime";
import { isSuperAdmin, landingPath } from "../onboarding";

const sessionChecks = new WeakMap<AbortSignal, Promise<AuthUser | null>>();

export function loadPlatformSession(
  signal: AbortSignal,
): Promise<AuthUser | null> {
  const pending = sessionChecks.get(signal);
  if (pending) return pending;

  const request = bootstrapSession().then((user) => {
    const store = usePlatformStore.getState();
    if (user) {
      store.setUser(user);
    } else {
      store.resetPlatformState();
    }
    return user;
  });
  sessionChecks.set(signal, request);
  return request;
}

export async function requirePlatformSession({
  request,
}: LoaderFunctionArgs): Promise<AuthUser> {
  const user = await loadPlatformSession(request.signal);
  if (!user) throw redirect("/login");
  if (!user.activeOrg && !isSuperAdmin(user)) {
    throw redirect(landingPath(user));
  }
  return user;
}

export async function platformLoader(args: LoaderFunctionArgs): Promise<null> {
  await requirePlatformSession(args);
  return null;
}
