import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySandbox, type SandboxConfig } from "./sandbox";

const BWRAP_PATH = "/usr/bin/bwrap";
const bwrapAvailable = fs.existsSync(BWRAP_PATH);

function makeConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    backend: "bubblewrap",
    isolateNetwork: true,
    writablePaths: [],
    ...overrides,
  };
}

function bindEntries(args: string[]): string[][] {
  const entries: string[][] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--bind") {
      entries.push([args[i + 1], args[i + 2]]);
    }
  }
  return entries;
}

describe("applySandbox", () => {
  it("returns the original command unchanged when backend is null", async () => {
    const result = await applySandbox({
      cmd: "ruby",
      args: ["-e", "puts 1"],
      cwd: "/tmp",
      config: { backend: null, isolateNetwork: true, writablePaths: [] },
    });
    expect(result).toEqual({
      cmd: "ruby",
      args: ["-e", "puts 1"],
      extraFds: [],
    });
  });

  it("uses /usr/bin/bwrap as the command", async () => {
    const result = await applySandbox({
      cmd: "ruby",
      args: [],
      cwd: "/tmp",
      config: makeConfig(),
    });
    expect(result.cmd).toBe("/usr/bin/bwrap");
  });

  it("includes --unshare-net when isolateNetwork is true", async () => {
    const result = await applySandbox({
      cmd: "ruby",
      args: [],
      cwd: "/tmp",
      config: makeConfig({ isolateNetwork: true }),
    });
    expect(result.args).toContain("--unshare-net");
  });

  it("omits --unshare-net when isolateNetwork is false", async () => {
    const result = await applySandbox({
      cmd: "ruby",
      args: [],
      cwd: "/tmp",
      config: makeConfig({ isolateNetwork: false }),
    });
    for (const s of result.extraFds) s.destroy();
    expect(result.args).not.toContain("--unshare-net");
  });

  it("includes --bind for each path in writablePaths", async () => {
    const paths = ["/workspace/repo", "/tmp/out-dir", "/opt/custom"];
    const result = await applySandbox({
      cmd: "ruby",
      args: [],
      cwd: "/tmp",
      config: makeConfig({ writablePaths: paths }),
    });
    const entries = bindEntries(result.args);
    for (const p of paths) {
      expect(entries).toContainEqual([p, p]);
    }
  });

  it("emits no --bind entries when writablePaths is empty", async () => {
    const result = await applySandbox({
      cmd: "ruby",
      args: [],
      cwd: "/tmp",
      config: makeConfig({ writablePaths: [] }),
    });
    expect(bindEntries(result.args)).toHaveLength(0);
  });

  it("omits --ro-bind-data and returns empty extraFds when isolateNetwork is true", async () => {
    const result = await applySandbox({
      cmd: "ruby",
      args: [],
      cwd: "/tmp",
      config: makeConfig({ isolateNetwork: true }),
    });
    expect(result.args).not.toContain("--ro-bind-data");
    expect(result.extraFds).toHaveLength(0);
  });

  describe.skipIf(!fs.existsSync("/etc/resolv.conf"))(
    "resolv.conf (requires /etc/resolv.conf)",
    () => {
      it("includes --ro-bind-data <realpath> when isolateNetwork is false", async () => {
        const realPath = fs.realpathSync("/etc/resolv.conf");
        const result = await applySandbox({
          cmd: "ruby",
          args: [],
          cwd: "/tmp",
          config: makeConfig({ isolateNetwork: false }),
        });
        for (const s of result.extraFds) s.destroy();
        expect(result.args).toContain("--ro-bind-data");
        expect(result.args).toContain(realPath);
      });

      it("populates extraFds with one entry and --ro-bind-data uses fdStart", async () => {
        const result = await applySandbox({
          cmd: "ruby",
          args: [],
          cwd: "/tmp",
          config: makeConfig({ isolateNetwork: false }),
          fdStart: 5,
        });
        for (const s of result.extraFds) s.destroy();
        expect(result.extraFds).toHaveLength(1);
        const idx = result.args.indexOf("--ro-bind-data");
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(result.args[idx + 1]).toBe("5");
      });
    },
  );
});

describe.skipIf(!bwrapAvailable)(
  "applySandbox integration (requires bwrap)",
  () => {
    async function spawnSandboxed(
      config: SandboxConfig,
      cmd: string,
      args: string[],
      cwd: string,
    ): Promise<{ stdout: string; stderr: string; code: number | null }> {
      const {
        cmd: spawnCmd,
        args: spawnArgs,
        extraFds,
      } = await applySandbox({
        cmd,
        args,
        cwd,
        config,
      });
      return new Promise((resolve, reject) => {
        const proc = childProcess.spawn(spawnCmd, spawnArgs, {
          cwd,
          stdio: ["ignore", "pipe", "pipe", ...extraFds],
          env: { PATH: process.env.PATH },
        });
        for (const fd of extraFds) fd.destroy();
        let stdout = "";
        let stderr = "";
        proc.stdout!.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        proc.stderr!.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        proc.on("close", (code) => resolve({ stdout, stderr, code }));
        proc.on("error", reject);
      });
    }

    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("hook runs in sandbox and output is captured correctly", async () => {
      const config = makeConfig({
        isolateNetwork: false,
        writablePaths: [tmpDir],
      });
      const { stdout, code } = await spawnSandboxed(
        config,
        "/bin/echo",
        ["hello from sandbox"],
        tmpDir,
      );
      expect(code).toBe(0);
      expect(stdout.trim()).toBe("hello from sandbox");
    });

    it("filesystem write is blocked outside allowed writable mounts", async () => {
      const config = makeConfig({
        isolateNetwork: false,
        writablePaths: [tmpDir],
      });
      const { code } = await spawnSandboxed(
        config,
        "/bin/sh",
        ["-c", "echo test > /home/sandbox-test-file"],
        tmpDir,
      );
      expect(code).not.toBe(0);
      expect(fs.existsSync("/home/sandbox-test-file")).toBe(false);
    });

    it("network is blocked when isolateNetwork is true", async () => {
      const config = makeConfig({
        isolateNetwork: true,
        writablePaths: [tmpDir],
      });
      const result = await spawnSandboxed(
        config,
        "/bin/sh",
        ["-c", "ip route show 2>&1 || true"],
        tmpDir,
      );
      // When network is isolated there should be no routes
      expect(result.stdout.trim()).toBe("");
    });

    it("env is clean: INPUT_* and GITHUB_TOKEN are not visible inside sandbox", async () => {
      process.env.INPUT_SECRET = "should-not-leak";
      process.env.GITHUB_TOKEN = "token-should-not-leak";
      try {
        const config = makeConfig({
          isolateNetwork: false,
          writablePaths: [tmpDir],
        });
        const { stdout, code } = await spawnSandboxed(
          config,
          "/bin/sh",
          ["-c", "printenv INPUT_SECRET GITHUB_TOKEN || true"],
          tmpDir,
        );
        expect(code).toBe(0);
        expect(stdout).toBe("");
      } finally {
        delete process.env.INPUT_SECRET;
        delete process.env.GITHUB_TOKEN;
      }
    });

    it("file written to outDir inside sandbox persists on host after exit", async () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-out-"));
      try {
        const sentinelPath = path.join(outDir, "sentinel");
        const config = makeConfig({
          isolateNetwork: false,
          writablePaths: [tmpDir, outDir],
        });
        const { code } = await spawnSandboxed(
          config,
          "/bin/sh",
          ["-c", `touch ${sentinelPath}`],
          tmpDir,
        );
        expect(code).toBe(0);
        expect(fs.existsSync(sentinelPath)).toBe(true);
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
  },
);
