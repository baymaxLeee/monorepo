import { watch, type FSWatcher } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSandbox, type SandboxOptions } from "../sandbox";

interface Workspace {
  sandbox: LocalSandbox;
  scratch: string;
  watcher: FSWatcher;
  changed: Map<string, number>;
  pendingChanges: Set<string>;
  changeTimer: ReturnType<typeof setTimeout> | null;
  flushChanges(): void;
  queue: Promise<unknown>;
  epoch: number;
}
export class LocalWorkspaces {
  private readonly workspaces = new Map<string, Promise<Workspace>>();
  private closed = false;
  constructor(
    private readonly options: Omit<SandboxOptions, "root" | "scratch">,
    private readonly onChange: (root: string, paths: string[]) => void,
  ) {}
  open(root: string): Promise<Workspace> {
    if (this.closed) throw new Error("本地运行时正在关闭");
    const previous = this.workspaces.get(root);
    if (previous) return previous;
    const promise = (async () => {
      const scratch = await realpath(await mkdtemp(join(tmpdir(), "monorepo-local-")));
      try {
        await mkdir(join(scratch, "bin"));
        await symlink(this.options.executable, join(scratch, "bin/node"));
        const settings: SandboxOptions = {
          ...this.options,
          root,
          scratch,
        };
        const sandbox = new LocalSandbox(settings);
        await sandbox.initialize();
        const state: Workspace = {
          sandbox,
          scratch,
          watcher: null as unknown as FSWatcher,
          changed: new Map(),
          pendingChanges: new Set(),
          changeTimer: null,
          flushChanges: () => {},
          queue: Promise.resolve(),
          epoch: 0,
        };
        const flushChanges = () => {
          if (state.changeTimer) clearTimeout(state.changeTimer);
          state.changeTimer = null;
          const paths = [...state.pendingChanges].sort();
          state.pendingChanges.clear();
          if (paths.length === 0) return;
          state.epoch++;
          if (state.changed.size + paths.length <= 1000) {
            for (const path of paths) state.changed.set(path, state.epoch);
          } else {
            state.changed.clear();
            state.changed.set(".", state.epoch);
          }
          this.onChange(root, paths);
        };
        state.flushChanges = flushChanges;
        const scheduleChange = (path: string) => {
          state.pendingChanges.add(path);
          if (state.changeTimer) clearTimeout(state.changeTimer);
          state.changeTimer = setTimeout(flushChanges, 50);
        };
        state.watcher = watch(root, { recursive: true }, (_event, filename) => {
          scheduleChange(filename?.toString() ?? ".");
        });
        state.watcher.on("error", () => scheduleChange("."));
        return state;
      } catch (error) {
        await rm(scratch, { recursive: true, force: true });
        throw error;
      }
    })();
    this.workspaces.set(root, promise);
    void promise.catch(() => this.workspaces.delete(root));
    return promise;
  }
  async access<T>(root: string, action: (workspace: Workspace) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("本地运行时正在关闭");
    const workspace = await this.open(root);
    const result = workspace.queue.then(() => action(workspace));
    workspace.queue = result.catch(() => undefined);
    return result;
  }
  async drain(root: string) {
    const workspace = await this.workspaces.get(root)?.catch(() => null);
    await workspace?.queue;
  }
  private async release(id: string) {
    const pending = this.workspaces.get(id);
    this.workspaces.delete(id);
    if (!pending) return;
    const workspace = await pending.catch(() => null);
    if (!workspace) return;
    workspace.sandbox.cancel();
    await workspace.queue;
    if (workspace.changeTimer) clearTimeout(workspace.changeTimer);
    workspace.watcher.close();
    await rm(workspace.scratch, { recursive: true, force: true });
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.workspaces.keys()].map((root) => this.release(root)));
  }
}
