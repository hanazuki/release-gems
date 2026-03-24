import * as childProcess from "node:child_process";
import * as core from "@actions/core";
import { z } from "zod";
import { cleanEnv } from "./env";
import { applySandbox, type SandboxConfig } from "./sandbox";

export async function runRuby<T extends z.ZodTypeAny>({
  ruby,
  cwd,
  args,
  script,
  schema,
  sandbox,
}: {
  ruby: string;
  cwd: string;
  script: string;
  args: string[];
  schema: T;
  sandbox?: SandboxConfig;
}): Promise<z.infer<T>> {
  const wrapped_script = `\
require 'json'
def write_result(payload) = IO.new(3).write JSON.generate(payload)
begin
  func = lambda do
${script}
end
  write_result data: func.call
rescue => e
  write_result error: "#{e.class}: #{e.message}"
end
`;

  const child = await (async () => {
    const env = cleanEnv();
    const {
      cmd,
      args: spawnArgs,
      extraFds,
    } = await applySandbox({
      cmd: ruby,
      args: ["-", ...args],
      cwd,
      config: sandbox,
      fdStart: 4,
    });

    try {
      core.debug(`environment: ${JSON.stringify(env)}`);
      core.debug(`command: ${JSON.stringify([cmd, ...spawnArgs])}`);

      return childProcess.spawn(cmd, spawnArgs, {
        cwd,
        env,
        stdio: ["pipe", "inherit", "inherit", "pipe", ...extraFds],
      });
    } finally {
      for (const fd of extraFds) fd.close();
    }
  })();

  const chunks: Buffer[] = [];
  (child.stdio[3]! as NodeJS.ReadableStream).on("data", (chunk: Buffer) =>
    chunks.push(chunk),
  );

  child.stdin!.end(wrapped_script);

  return new Promise((resolve, reject) => {
    child.on("close", (status) => {
      if (status !== 0) {
        reject(new Error(`Ruby exited with status ${status}`));
        return;
      }

      const envelope = z
        .union([z.object({ data: schema }), z.object({ error: z.string() })])
        .parse(JSON.parse(Buffer.concat(chunks).toString()));

      if ("error" in envelope) {
        reject(new Error(envelope.error));
      } else {
        resolve(envelope.data);
      }
    });

    child.on("error", reject);
  });
}
