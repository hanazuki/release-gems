import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGem, loadGemspec } from "#/gem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEMSPEC_PATH = path.resolve(__dirname, "../../fixtures/test_gem.gemspec");
const RUBY = "ruby";

describe("loadGemspec", () => {
  it("returns name and version from gemspec", async () => {
    const info = await loadGemspec(RUBY, GEMSPEC_PATH);
    expect(info.name).toBe("test_gem");
    expect(info.version).toBe("0.1.0");
    expect(info.platform).toBe("ruby");
    expect(info.metadata.allowed_push_host).toBe("https://gems.example.com");
  });

  it("throws for a nonexistent gemspec", async () => {
    await expect(
      loadGemspec(RUBY, path.join(os.tmpdir(), "nonexistent.gemspec")),
    ).rejects.toThrow();
  });
});

describe("buildGem", () => {
  it("builds the gem into a temporary directory", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `release-gems-gem-test-${process.pid}-`),
    );
    try {
      const result = await buildGem(RUBY, GEMSPEC_PATH, tmpDir);
      expect(result.path).toBe(path.join(tmpDir, "test_gem-0.1.0.gem"));
      expect(fs.existsSync(result.path)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws for a nonexistent gemspec", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `release-gems-gem-test-${process.pid}-`),
    );
    try {
      await expect(
        buildGem(RUBY, path.join(os.tmpdir(), "nonexistent.gemspec"), tmpDir),
      ).rejects.toThrow();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
