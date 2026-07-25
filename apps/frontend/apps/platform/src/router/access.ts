import { type AuthUser, bootstrapSession } from "api";
import { createContext, type MiddlewareFunction, redirect } from "react-router-dom";
import { usePlatformStore } from "runtime";

import { activeMemberships, canEnterPlatform, isSuperAdmin, landingPath } from "../onboarding";
import type { AppEntry } from "./app-registry";

export const platformUserContext = createContext<AuthUser | null>(null);

const sessionChecks = new WeakMap<AbortSignal, Promise<AuthUser | null>>();

async function resolveSession(signal: AbortSignal): Promise<AuthUser | null> {
  const pending = sessionChecks.get(signal);
  if (pending) {
    return pending;
  }

  const request = bootstrapSession().then((user) => {
    const store = usePlatformStore.getState();
    if (user) {
      if (store.user !== user) {
        store.setUser(user);
      }
    } else if (store.user) {
      store.resetPlatformState();
    }
    return user;
  });
  sessionChecks.set(signal, request);
  return request;
}

function authenticated(redirectTo: (user: AuthUser) => string | null): MiddlewareFunction {
  return async ({ request, context }) => {
    const user = await resolveSession(request.signal);
    if (!user) {
      throw redirect("/login");
    }

    const target = redirectTo(user);
    if (target) {
      throw redirect(target);
    }
    context.set(platformUserContext, user);
  };
}

export const guestOnlyMiddleware: MiddlewareFunction = async ({ request, context }) => {
  const user = await resolveSession(request.signal);
  context.set(platformUserContext, user);
  if (user) {
    throw redirect(landingPath(user));
  }
};

export const platformAccessMiddleware = authenticated((user) => (canEnterPlatform(user) ? null : landingPath(user)));

export const pendingAccessMiddleware = authenticated((user) => {
  if (canEnterPlatform(user)) {
    return "/platform/chat";
  }
  return activeMemberships(user).length > 0 ? "/select-org" : null;
});

export const selectOrgAccessMiddleware = authenticated((user) => {
  if (canEnterPlatform(user)) {
    return "/platform/chat";
  }
  return activeMemberships(user).length === 0 ? "/pending" : null;
});

export async function canDiscoverPlatformRoutes(signal: AbortSignal): Promise<boolean> {
  const user = await resolveSession(signal);
  return !!user && canEnterPlatform(user);
}

export function createAppAccessMiddleware(app: AppEntry): MiddlewareFunction {
  return async ({ context }) => {
    const user = context.get(platformUserContext);
    if (!user) {
      throw redirect("/login");
    }

    const canAccess =
      app.is_enabled && (!app.requires_admin || isSuperAdmin(user) || user.activeOrg?.role === "org_admin");
    if (!canAccess) {
      throw new Response("Not Found", { status: 404 });
    }
  };
}
