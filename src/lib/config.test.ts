import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfigLocal, parseConfig } from "#/config";

describe("parseConfig", () => {
  it("parses a full valid config", () => {
    const yaml = `
gems:
  - directory: foo
    gemspec: foo.gemspec
    hooks:
      prebuild: bundle exec rake generate
      postbuild: echo done
  - directory: bar
    gemspec: bar.gemspec
hooks:
  prebuild: global pre
  postbuild: global post
registries:
  - host: https://rubygems.org
  - host: https://gems.example.com
`;
    const config = parseConfig(yaml);
    expect(config).toEqual({
      gems: [
        {
          directory: "foo",
          gemspec: "foo.gemspec",
          hooks: {
            prebuild: "bundle exec rake generate",
            postbuild: "echo done",
          },
        },
        {
          directory: "bar",
          gemspec: "bar.gemspec",
        },
      ],
      hooks: { prebuild: "global pre", postbuild: "global post" },
      registries: [
        { host: "https://rubygems.org" },
        { host: "https://gems.example.com" },
      ],
    });
  });

  it("parses a config with only gems", () => {
    const yaml = `
gems:
  - directory: foo
`;
    const config = parseConfig(yaml);
    expect(config).toEqual({
      gems: [{ directory: "foo" }],
      registries: [{ host: "https://rubygems.org" }],
    });
    expect(config.hooks).toBeUndefined();
  });

  it("throws on empty content", () => {
    expect(() => parseConfig("")).toThrow("Invalid config file");
  });

  it("throws on null YAML content", () => {
    expect(() => parseConfig("null")).toThrow("Invalid config file");
  });

  it("applies default registries when not specified", () => {
    const config = parseConfig("gems:\n  - directory: foo\n");
    expect(config.registries).toEqual([{ host: "https://rubygems.org" }]);
  });
});

describe("loadConfigLocal", () => {
  it("returns Config for an existing file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-gems-test-"));
    try {
      fs.mkdirSync(path.join(tmpDir, ".github"));
      fs.writeFileSync(
        path.join(tmpDir, ".github", "release-gems.yml"),
        `gems:
  - directory: foo
hooks:
  prebuild: echo hi
registries:
  - host: https://gems.example.com
`,
        "utf8",
      );
      const config = await loadConfigLocal(tmpDir);
      expect(config).toEqual({
        gems: [{ directory: "foo" }],
        hooks: { prebuild: "echo hi" },
        registries: [{ host: "https://gems.example.com" }],
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("returns DEFAULT_CONFIG when config file is absent", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-gems-test-"));
    try {
      const config = await loadConfigLocal(tmpDir);
      expect(config).toEqual({
        registries: [{ host: "https://rubygems.org" }],
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("throws for an empty config file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-gems-test-"));
    try {
      fs.mkdirSync(path.join(tmpDir, ".github"));
      fs.writeFileSync(
        path.join(tmpDir, ".github", "release-gems.yml"),
        "",
        "utf8",
      );
      await expect(loadConfigLocal(tmpDir)).rejects.toThrow(
        "Invalid config file",
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
