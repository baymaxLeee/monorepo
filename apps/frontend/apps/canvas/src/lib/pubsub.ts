type Listener<Payload> = (payload: Payload) => void;

/**
 * 泛型发布订阅，对齐 Node EventEmitter / mitt 的最小表面：on / off / once / emit。
 *
 * class 是公共原语，实例按协作域创建并共享（例如分镜工作区一份，给素材条、
 * 编辑器、后续画布共用）。不要每个组件 new 一份，也不要挂成全应用单例。
 */
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
    if (!bucket) {
      return;
    }
    bucket.delete(listener as Listener<Events[keyof Events]>);
    if (bucket.size === 0) {
      this.listeners.delete(event);
    }
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
    if (!bucket) {
      return;
    }
    const value = payload[0] as Events[K];
    // 拷贝后再通知，避免回调里 off 打乱当前轮次。
    for (const listener of [...bucket]) {
      (listener as Listener<Events[K]>)(value);
    }
  }

  /** 离开协作域时清订阅，避免编辑器 / 画布监听残留。 */
  clear(): void {
    this.listeners.clear();
  }
}
