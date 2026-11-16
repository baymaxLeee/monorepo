export class WorkspaceGrants {
  readonly #pending = new Set<string>();

  clear() {
    this.#pending.clear();
  }

  grant(workspace: string) {
    this.#pending.add(workspace);
  }

  authorize(workspace: string, existingWorkspaces: Iterable<string>) {
    if (new Set(existingWorkspaces).has(workspace)) return true;
    return this.#pending.delete(workspace);
  }
}
