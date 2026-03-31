import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runRuby } from "#/ruby";

const RUBY = "ruby";
const CWD = os.tmpdir();

describe("runRuby", () => {
  it("chdirs before running Ruby code", async () => {
    const result = await runRuby({
      ruby: RUBY,
      cwd: CWD,
      args: [],
      script: "{ cwd: Dir.pwd }",
      schema: z.object({ cwd: z.string() }),
    });
    expect(result).toEqual({ cwd: CWD });
  });

  it("returns parsed data on success", async () => {
    const result = await runRuby({
      ruby: RUBY,
      cwd: CWD,
      args: ["hello", "42"],
      script: "{name: ARGV[0], count: ARGV[1].to_i}",
      schema: z.object({ name: z.string(), count: z.number() }),
    });
    expect(result).toEqual({ name: "hello", count: 42 });
  });

  it("throws when the script raises an exception", async () => {
    await expect(
      runRuby({
        ruby: RUBY,
        cwd: CWD,
        args: [],
        script: `raise "something went wrong"`,
        schema: z.object({}),
      }),
    ).rejects.toThrow(/something went wrong/);
  });

  describe("environment cleaning", () => {
    const FAKE_VARS: Record<string, string> = {
      "INPUT_GITHUB-TOKEN": "input-secret",
      GITHUB_TOKEN: "gh-token",
      ACTIONS_RUNTIME_TOKEN: "actions-token",
    };

    beforeEach(() => {
      for (const [k, v] of Object.entries(FAKE_VARS)) {
        process.env[k] = v;
      }
    });

    afterEach(() => {
      for (const k of Object.keys(FAKE_VARS)) {
        delete process.env[k];
      }
    });

    it("does not expose INPUT_*, GITHUB_TOKEN, or ACTIONS_* to the Ruby process", async () => {
      const result = await runRuby({
        ruby: RUBY,
        cwd: CWD,
        args: [],
        script: `ENV.slice("INPUT_GITHUB-TOKEN", "GITHUB_TOKEN", "ACTIONS_RUNTIME_TOKEN")`,
        schema: z.record(z.string(), z.string()),
      });
      expect(result).toEqual({});
    });
  });
});
