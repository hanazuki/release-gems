import * as fs from "node:fs";

export type SandboxConfig = {
  backend: "bubblewrap" | null;
  isolateNetwork: boolean;
  writablePaths: string[];
};

export async function applySandbox({
  cmd,
  args,
  cwd,
  config,
  fdStart = 3,
}: {
  cmd: string;
  args: string[];
  cwd: string;
  config?: SandboxConfig;
  fdStart?: number;
}): Promise<{ cmd: string; args: string[]; extraFds: fs.ReadStream[] }> {
  if (config == null || config.backend === null) {
    return { cmd, args, extraFds: [] };
  }

  const extraFds: fs.ReadStream[] = [];
  const networkArgs: string[] = [];

  if (config.isolateNetwork) {
    networkArgs.push("--unshare-net");
  } else {
    try {
      // Workaround: https://github.com/containers/bubblewrap/issues/390
      const realPath = await fs.promises.realpath("/etc/resolv.conf");
      const fh = await fs.promises.open("/etc/resolv.conf", "r");
      networkArgs.push("--ro-bind-data", String(fdStart), realPath);
      extraFds.push(fh.createReadStream({ autoClose: true }));
    } catch {
      // silently skip if /etc/resolv.conf cannot be opened or resolved
    }
  }

  const bwrapArgs: string[] = [
    ...["--ro-bind", "/", "/"],
    ...["--dev", "/dev"],
    ...["--proc", "/proc"],
    ...["--tmpfs", "/tmp"],
    ...["--tmpfs", "/var/tmp"],
    ...["--tmpfs", "/sys"],
    ...["--tmpfs", "/run"],
    ...["--symlink", "/run", "/var/run"],
    ...config.writablePaths.flatMap((p) => ["--bind", p, p]),
    "--unshare-user",
    ...["--uid", String(process.getuid!())],
    ...["--gid", String(process.getgid!())],
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    ...networkArgs,
    ...["--chdir", cwd],
    "--new-session",
    "--die-with-parent",
    "--",
    cmd,
    ...args,
  ];

  return { cmd: "/usr/bin/bwrap", args: bwrapArgs, extraFds };
}
