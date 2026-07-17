import { type AuthUser, bootstrapSession } from "api";
import {
  createContext,
  type MiddlewareFunction,
  redirect,
} from "react-router-dom";
import { usePlatformStore } from "runtime";
import {
  activeMemberships,
  canEnterPlatform,
  landingPath,
} from "../onboarding";
import { loadApps } from "./app-registry";

export const platformUserContext = createContext<AuthUser | null>(null);

const sessionChecks = new WeakMap<AbortSignal, Promise<AuthUser | null>>();

async function resolveSession(signal: AbortSignal): Promise<AuthUser | null> {
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

function authenticated(
  redirectTo: (user: AuthUser) => string | null,
): MiddlewareFunction {
  return async ({ request, context }) => {
    const user = await resolveSession(request.signal);
    if (!user) throw redirect("/login");

    const target = redirectTo(user);
    if (target) throw redirect(target);
    context.set(platformUserContext, user);
  };
}

export const guestOnlyMiddleware: MiddlewareFunction = async ({
  request,
  context,
}) => {
  const user = await resolveSession(request.signal);
  context.set(platformUserContext, user);
  if (user) throw redirect(landingPath(user));
};

export const platformAccessMiddleware = authenticated((user) =>
  canEnterPlatform(user) ? null : landingPath(user),
);

export const pendingAccessMiddleware = authenticated((user) => {
  if (canEnterPlatform(user)) return "/platform/chat";
  return activeMemberships(user).length > 0 ? "/select-org" : null;
});

export const selectOrgAccessMiddleware = authenticated((user) => {
  if (canEnterPlatform(user)) return "/platform/chat";
  return activeMemberships(user).length === 0 ? "/pending" : null;
});

export async function canDiscoverPlatformRoutes(
  signal: AbortSignal,
): Promise<boolean> {
  const user = await resolveSession(signal);
  return !!user && canEnterPlatform(user);
}

export function createAppAccessMiddleware(appId: string): MiddlewareFunction {
  return async ({ context }) => {
    if (!context.get(platformUserContext)) throw redirect("/login");

    const apps = await loadApps({ refresh: true });
    if (!apps.some((app) => app.id === appId && app.is_enabled)) {
      throw new Response("Not Found", { status: 404 });
    }
  };
}
