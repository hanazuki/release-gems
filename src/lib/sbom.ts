import * as fs from "node:fs";

/**
 * Reads, validates, and resolves the predicate type of an SBOM file.
 * Throws with a user-friendly message if:
 * - the file does not exist or is not readable ("SBOM file not found: {path}")
 * - the file is not valid JSON ("SBOM file is not valid JSON. Only JSON-format SBOMs are supported.")
 * - the parsed JSON is not an object ("SBOM file must be a JSON object.")
 * - the predicate type cannot be resolved (see resolvePredicateType)
 * Returns the parsed JSON object as predicate and the resolved predicateType URI.
 */
export async function loadSbom(
  path: string,
  predicateTypeOverride?: string,
): Promise<{ predicate: Record<string, unknown>; predicateType: string }> {
  let content: string;
  try {
    content = await fs.promises.readFile(path, { encoding: "utf8" });
  } catch (cause) {
    throw new Error(`SBOM file not found: ${path}`, { cause });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    throw new Error(
      "SBOM file is not valid JSON. Only JSON-format SBOMs are supported.",
      { cause },
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SBOM file must be a JSON object.");
  }

  const predicate = parsed as Record<string, unknown>;
  const predicateType =
    predicateTypeOverride != null
      ? predicateTypeOverride
      : resolvePredicateType(predicate);
  return { predicate, predicateType };
}

/**
 * Determines the in-toto predicateType URI for the SBOM.
 * If predicateTypeOverride is provided, returns it unchanged.
 * Otherwise, auto-detects from the parsed SBOM content:
 *   - CycloneDX JSON    →  "https://cyclonedx.org/bom/v{specVersion}"
 *   - SPDX 2.x JSON     →  "https://spdx.dev/Document"
 *   - SPDX 3.x JSON-LD  →  "https://spdx.dev/Document/v3"
 *   - Conflicting or unrecognized  →  throws with instructions to set sbom-predicate-type
 */
function resolvePredicateType(sbomContent: Record<string, unknown>): string {
  const isCycloneDX = sbomContent.bomFormat === "CycloneDX";
  const isSPDX2 = sbomContent.SPDXID === "SPDXRef-DOCUMENT";
  const isSPDX3 = hasSpdx3Context(sbomContent["@context"]);

  const matchCount = [isCycloneDX, isSPDX2, isSPDX3].filter(Boolean).length;

  if (matchCount !== 1) {
    throw new Error(
      "Unable to detect SBOM predicate type from file content. Set the 'sbom-predicate-type' input explicitly.",
    );
  }

  if (isCycloneDX) {
    if (typeof sbomContent.specVersion !== "string") {
      throw new Error("CycloneDX SBOM is missing 'specVersion' field");
    }
    return `https://cyclonedx.org/bom/v${sbomContent.specVersion}`;
  }

  if (isSPDX2) {
    if (typeof sbomContent.spdxVersion !== "string") {
      throw new Error("SPDX SBOM is missing 'spdxVersion' field");
    }
    return "https://spdx.dev/Document";
  }

  // isSPDX3
  return "https://spdx.dev/Document/v3";
}

function hasSpdx3Context(context: unknown): boolean {
  const prefix = "https://spdx.org/rdf/3.";
  if (typeof context === "string") {
    return context.startsWith(prefix);
  }
  if (Array.isArray(context)) {
    return context.some(
      (item) => typeof item === "string" && item.startsWith(prefix),
    );
  }
  return false;
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("resolvePredicateType", () => {
    it("detects CycloneDX and returns versioned URI", () => {
      expect(
        resolvePredicateType({ bomFormat: "CycloneDX", specVersion: "1.6" }),
      ).toBe("https://cyclonedx.org/bom/v1.6");
    });

    it("throws when CycloneDX specVersion is missing", () => {
      expect(() => resolvePredicateType({ bomFormat: "CycloneDX" })).toThrow(
        "CycloneDX SBOM is missing 'specVersion' field",
      );
    });

    it("detects SPDX 2.x when spdxVersion is present and SPDXID is SPDXRef-DOCUMENT", () => {
      expect(
        resolvePredicateType({
          spdxVersion: "SPDX-2.3",
          SPDXID: "SPDXRef-DOCUMENT",
        }),
      ).toBe("https://spdx.dev/Document");
    });

    it("throws when SPDXID is SPDXRef-DOCUMENT but spdxVersion is missing", () => {
      expect(() =>
        resolvePredicateType({ SPDXID: "SPDXRef-DOCUMENT" }),
      ).toThrow("SPDX SBOM is missing 'spdxVersion' field");
    });

    it("does not detect SPDX 2.x when SPDXID is not SPDXRef-DOCUMENT", () => {
      expect(() =>
        resolvePredicateType({
          spdxVersion: "SPDX-2.3",
          SPDXID: "SPDXRef-File",
        }),
      ).toThrow(
        "Unable to detect SBOM predicate type from file content. Set the 'sbom-predicate-type' input explicitly.",
      );
    });

    it("detects SPDX 3.x from a string @context", () => {
      expect(
        resolvePredicateType({
          "@context": "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
        }),
      ).toBe("https://spdx.dev/Document/v3");
    });

    it("detects SPDX 3.x from an array @context", () => {
      expect(
        resolvePredicateType({
          "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
          ],
        }),
      ).toBe("https://spdx.dev/Document/v3");
    });

    it("throws for mixed CycloneDX and SPDX 2.x indicators", () => {
      expect(() =>
        resolvePredicateType({
          bomFormat: "CycloneDX",
          specVersion: "1.6",
          spdxVersion: "SPDX-2.3",
          SPDXID: "SPDXRef-DOCUMENT",
        }),
      ).toThrow(
        "Unable to detect SBOM predicate type from file content. Set the 'sbom-predicate-type' input explicitly.",
      );
    });

    it("throws for unrecognized format", () => {
      expect(() => resolvePredicateType({ custom: "format" })).toThrow(
        "Unable to detect SBOM predicate type from file content. Set the 'sbom-predicate-type' input explicitly.",
      );
    });
  });
}
