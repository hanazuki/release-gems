import { spawn } from "node:child_process";
import * as core from "@actions/core";
import { cleanEnv } from "#/env";
import { applySandbox, type SandboxConfig } from "#/sandbox";

export interface HookEnv {
  RELEASE_GEMS_GEM_NAME?: string;
  RELEASE_GEMS_GEM_VERSION?: string;
  RELEASE_GEMS_GEMSPEC_PATH?: string;
}

/**
 * Run a hook command via the system shell ($SHELL).
 * A null/undefined command is silently skipped.
 * Non-zero exit code throws an error, aborting the job.
 *
 * @param command  Shell command string, or null/undefined to skip.
 * @param cwd      Working directory for the subprocess.
 * @param hookEnv  Additional environment variables to inject.
 * @param sandbox  Optional sandbox configuration.
 */
export async function runHook(
  command: string | null | undefined,
  cwd: string,
  hookEnv?: HookEnv,
  sandbox?: SandboxConfig,
): Promise<void> {
  if (command == null) {
    return;
  }

  const child = await (async () => {
    const env = { ...cleanEnv(), ...hookEnv };
    const { cmd, args, extraFds } = await applySandbox({
      cmd: process.env.SHELL ?? "/bin/sh",
      args: ["-c", command],
      cwd,
      config: sandbox,
    });

    try {
      core.debug(`environment: ${JSON.stringify(env)}`);
      core.debug(`command: ${JSON.stringify([cmd, ...args])}`);

      return spawn(cmd, args, {
        cwd,
        env,
        stdio: ["inherit", "inherit", "inherit", ...extraFds],
      });
    } finally {
      for (const fd of extraFds) fd.close();
    }
  })();

  return new Promise<void>((resolve, reject) => {
    child.on("error", reject);

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Hook exited with code ${code}: ${command}`));
      }
    });
  });
}
