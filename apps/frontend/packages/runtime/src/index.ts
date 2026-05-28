/**
 * MFE runtime: lightweight pub/sub event bus and helpers.
 * MFEs SHOULD NOT import from each other; cross-MFE signaling goes here.
 */
export {
  type PlatformMenuItem,
  type PlatformState,
  type PlatformSubMenuItem,
  type PlatformUser,
  usePlatformStore,
} from "./store/usePlatformStore";

type Handler<T = unknown> = (payload: T) => void;

const handlers = new Map<string, Set<Handler>>();

export function emit<T = unknown>(event: string, payload: T): void {
  handlers.get(event)?.forEach((h) => h(payload));
}

export function on<T = unknown>(
  event: string,
  handler: Handler<T>,
): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler as Handler);
  return () => handlers.get(event)?.delete(handler as Handler);
}

export const Events = {
  AuthChanged: "auth:changed",
  BotPublished: "bot:published",
  ScenePicked: "scene:picked",
} as const;
