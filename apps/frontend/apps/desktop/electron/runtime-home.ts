import { homedir } from "node:os";
import { isAbsolute, join, normalize, parse, resolve } from "node:path";

export const RUNTIME_HOME_ENV = "MONOREPO_AGENT_HOME";

export function resolveRuntimeHome(environment: NodeJS.ProcessEnv = process.env, userHome: string = homedir()): string {
  const configured = environment[RUNTIME_HOME_ENV]?.trim();
  const candidate = configured || join(userHome, ".monorepo-agent");
  if (!isAbsolute(candidate)) throw new Error(`${RUNTIME_HOME_ENV} 必须是绝对路径`);
  const directory = normalize(resolve(candidate));
  if (directory === parse(directory).root) throw new Error(`${RUNTIME_HOME_ENV} 不能指向文件系统根目录`);
  return directory;
}

export function scopedSessionDirectory(runtimeHome: string, scope: string): string {
  if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error("本地会话身份分区无效");
  return join(runtimeHome, "sessions", scope);
}

export function legacySessionDirectories(appData: string, userData: string, scope: string): string[] {
  const candidates = [
    join(userData, "local", scope),
    join(appData, "desktop", "local", scope),
    join(appData, "monorepo-desktop", "local", scope),
    join(appData, "Monorepo", "local", scope),
  ];
  return [...new Set(candidates.map((directory) => resolve(directory)))];
}
