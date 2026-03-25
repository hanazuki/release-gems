import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSbom } from "#/sbom";

describe("loadSbom", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-gems-sbom-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws when file does not exist", async () => {
    const p = path.join(tempDir, "missing.json");
    await expect(loadSbom(p)).rejects.toThrow(`SBOM file not found: ${p}`);
  });

  it("throws when file is not valid JSON", async () => {
    const p = path.join(tempDir, "bad.json");
    fs.writeFileSync(p, "not json");
    await expect(loadSbom(p)).rejects.toThrow(
      "SBOM file is not valid JSON. Only JSON-format SBOMs are supported.",
    );
  });

  it("throws when file contains a JSON array", async () => {
    const p = path.join(tempDir, "array.json");
    fs.writeFileSync(p, "[]");
    await expect(loadSbom(p)).rejects.toThrow(
      "SBOM file must be a JSON object.",
    );
  });

  it("returns predicate and predicateType for a valid CycloneDX file", async () => {
    const p = path.join(tempDir, "sbom.json");
    const sbom = { bomFormat: "CycloneDX", specVersion: "1.6" };
    fs.writeFileSync(p, JSON.stringify(sbom));
    await expect(loadSbom(p)).resolves.toEqual({
      predicate: sbom,
      predicateType: "https://cyclonedx.org/bom/v1.6",
    });
  });

  it("uses predicateTypeOverride when provided", async () => {
    const p = path.join(tempDir, "sbom.json");
    fs.writeFileSync(p, JSON.stringify({ custom: "format" }));
    const result = await loadSbom(p, "https://example.com/custom");
    expect(result.predicateType).toBe("https://example.com/custom");
    expect(result.predicate).toEqual({ custom: "format" });
  });
});
