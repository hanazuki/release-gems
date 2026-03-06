import * as childProcess from "node:child_process";
import { z } from "zod";

export function runRuby<T extends z.ZodTypeAny>({
  ruby,
  cwd,
  args,
  script,
  schema,
}: {
  ruby: string;
  cwd: string;
  script: string;
  args: string[];
  schema: T;
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

  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn(ruby, ["-", ...args], {
      cwd,
      stdio: ["pipe", "inherit", "inherit", "pipe"],
    });

    const chunks: Buffer[] = [];
    (proc.stdio[3]! as NodeJS.ReadableStream).on("data", (chunk: Buffer) =>
      chunks.push(chunk),
    );

    proc.stdin!.end(wrapped_script);

    proc.on("close", (status) => {
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

    proc.on("error", reject);
  });
}
