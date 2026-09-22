type Listener<Payload> = (payload: Payload) => void;

/** 协作域内共享的轻量发布订阅；实例由域顶层创建并在离开时清理。 */
export class PubSub<Events extends Record<PropertyKey, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<Listener<Events[keyof Events]>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener as Listener<Events[keyof Events]>);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    bucket.delete(listener as Listener<Events[keyof Events]>);
    if (bucket.size === 0) this.listeners.delete(event);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const wrapped: Listener<Events[K]> = (payload) => {
      this.off(event, wrapped);
      listener(payload);
    };
    return this.on(event, wrapped);
  }

  emit<K extends keyof Events>(event: K, ...payload: Events[K] extends void ? [] : [Events[K]]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    const value = payload[0] as Events[K];
    for (const listener of [...bucket]) (listener as Listener<Events[K]>)(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
