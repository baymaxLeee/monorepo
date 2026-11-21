import { CommandSessions } from "./command-sessions.js";
import { ProcessManager } from "./process-manager.js";

/** Services with session lifetime, independent of the current model Turn. */
export class SessionServices {
  readonly commands = new CommandSessions();
  readonly processes = new ProcessManager();

  async close() {
    const drained = this.commands.close();
    this.processes.closeAll();
    await drained;
  }
}
