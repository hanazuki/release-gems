import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetInput,
  mockSetFailed,
  mockAttestProvenance,
  mockAttest,
  mockUploadArtifact,
  mockGetRef,
  mockGetTag,
  mockGetOctokit,
} = vi.hoisted(() => {
  const mockUploadArtifact = vi.fn();
  const mockGetRef = vi.fn();
  const mockGetTag = vi.fn();
  const mockGetOctokit = vi.fn(() => ({
    rest: { git: { getRef: mockGetRef, getTag: mockGetTag } },
  }));
  return {
    mockGetInput:
      vi.fn<(name: string, options?: { required?: boolean }) => string>(),
    mockSetFailed: vi.fn(),
    mockAttestProvenance: vi.fn(),
    mockAttest: vi.fn(),
    mockUploadArtifact,
    mockGetRef,
    mockGetTag,
    mockGetOctokit,
  };
});

vi.mock("@actions/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@actions/core")>()),
  getInput: mockGetInput,
  setFailed: mockSetFailed,
}));

vi.mock("@actions/attest", () => ({
  attestProvenance: mockAttestProvenance,
  attest: mockAttest,
}));

vi.mock("@actions/artifact", () => ({
  default: {
    uploadArtifact: mockUploadArtifact,
  },
}));

vi.mock("@actions/github", async (importOriginal) => {
  const original = await importOriginal<typeof import("@actions/github")>();
  const context = Object.create(original.context);
  Object.defineProperty(context, "ref", {
    get: () => process.env.GITHUB_REF ?? "",
    configurable: true,
  });
  Object.defineProperty(context, "eventName", {
    get: () => process.env.GITHUB_EVENT_NAME ?? "",
    configurable: true,
  });
  Object.defineProperty(context, "payload", {
    get: () => {
      const p = process.env.GITHUB_EVENT_PATH;
      if (p) return JSON.parse(fs.readFileSync(p, { encoding: "utf8" }));
      return {};
    },
    configurable: true,
  });
  return { ...original, context, getOctokit: mockGetOctokit };
});

// Helpers

function gemspecContent(
  name: string,
  version: string,
  metadata: Record<string, string> = {},
): string {
  const metadataLines = Object.entries(metadata).map(
    ([k, v]) => `  s.metadata["${k}"] = "${v}"`,
  );
  return [
    "Gem::Specification.new do |s|",
    `  s.name = "${name}"`,
    `  s.version = "${version}"`,
    '  s.summary = "Test gem"',
    '  s.authors = ["Test"]',
    "  s.files = []",
    ...metadataLines,
    "end",
  ].join("\n");
}

async function loadBuild(): Promise<void> {
  vi.resetModules();
  const mod = (await import("./build")) as { completed: Promise<void> };
  await mod.completed;
}

// Setup / teardown

let workspace: string;

beforeEach(() => {
  vi.resetAllMocks();

  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "release-gems-test-"));
  fs.mkdirSync(path.join(workspace, ".github"), { recursive: true });

  process.env.GITHUB_WORKSPACE = workspace;
  process.env.GITHUB_REF = "refs/heads/main";
  process.env.GITHUB_REPOSITORY = "test-owner/test-repo";

  mockGetInput.mockImplementation((name: string) => {
    switch (name) {
      case "github-token":
        return "gha-token";
      case "job":
        return "default";
      case "retention-days":
        return "";
      case "ruby":
        return "ruby";
      default:
        return "";
    }
  });

  mockGetRef.mockResolvedValue({
    data: { object: { type: "tag", sha: "abc123" } },
  });
  mockGetTag.mockResolvedValue({
    data: { verification: { verified: true, reason: "valid" } },
  });

  mockAttestProvenance.mockResolvedValue({
    bundle: { mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" },
    attestationID: "provenance-id",
    tlogID: "provenance-tlog",
  });
  mockAttest.mockResolvedValue({
    bundle: { mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" },
    attestationID: "sbom-id",
    tlogID: "sbom-tlog",
  });
  mockUploadArtifact.mockResolvedValue({ id: 1, size: 0 });
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  process.env.GITHUB_WORKSPACE = undefined;
  process.env.GITHUB_REF = undefined;
  process.env.GITHUB_EVENT_NAME = undefined;
  process.env.GITHUB_EVENT_PATH = undefined;
});

// Tests

describe("build action", () => {
  it("branch push with auto-detected single gemspec builds and uploads gem", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0"),
    );

    await loadBuild();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockUploadArtifact).toHaveBeenCalledOnce();
    expect(mockUploadArtifact).toHaveBeenCalledWith(
      "release-gems-foo-ruby",
      [
        expect.stringContaining("index.json"),
        expect.stringContaining("foo-1.0.0.gem"),
        expect.stringContaining("provenance-f2168ec3.sigstore.json"),
      ],
      expect.any(String),
      { retentionDays: 0 },
    );
  });

  it("auto-detect with zero gemspecs fails", async () => {
    await loadBuild();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("No .gemspec files found"),
    );
    expect(mockUploadArtifact).not.toHaveBeenCalled();
  });

  it("auto-detect with multiple gemspecs fails", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0"),
    );
    fs.writeFileSync(
      path.join(workspace, "bar.gemspec"),
      gemspecContent("bar", "1.0.0"),
    );

    await loadBuild();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Multiple .gemspec files found"),
    );
    expect(mockUploadArtifact).not.toHaveBeenCalled();
  });

  it("unified tag with matching version succeeds", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "2.0.0"),
    );
    process.env.GITHUB_REF = "refs/tags/v2.0.0";

    await loadBuild();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockUploadArtifact).toHaveBeenCalledOnce();
  });

  it("unified tag with version mismatch fails", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0"),
    );
    process.env.GITHUB_REF = "refs/tags/v2.0.0";

    await loadBuild();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Version mismatch"),
    );
    expect(mockUploadArtifact).not.toHaveBeenCalled();
  });

  it("per-gem tag builds only the matching gem", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0"),
    );
    fs.writeFileSync(
      path.join(workspace, "bar.gemspec"),
      gemspecContent("bar", "2.0.0"),
    );
    fs.writeFileSync(
      path.join(workspace, ".github", "release-gems.yml"),
      "gems:\n- gemspec: foo.gemspec\n- gemspec: bar.gemspec\n",
    );
    process.env.GITHUB_REF = "refs/tags/bar/v2.0.0";

    await loadBuild();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockUploadArtifact).toHaveBeenCalledTimes(1);
    expect(mockUploadArtifact).toHaveBeenCalledWith(
      "release-gems-bar-ruby",
      [
        expect.stringContaining("index.json"),
        expect.stringContaining("bar-2.0.0.gem"),
        expect.any(String),
      ],
      expect.any(String),
      { retentionDays: 0 },
    );
  });

  it("per-gem tag with no matching gem fails", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0"),
    );
    fs.writeFileSync(
      path.join(workspace, ".github", "release-gems.yml"),
      "gems:\n- gemspec: foo.gemspec\n",
    );
    process.env.GITHUB_REF = "refs/tags/nonexistent/v1.0.0";

    await loadBuild();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("No gem named"),
    );
    expect(mockUploadArtifact).not.toHaveBeenCalled();
  });

  it("allowed_push_host matches the only configured registry succeeds", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0", {
        allowed_push_host: "https://rubygems.org",
      }),
    );

    await loadBuild();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockUploadArtifact).toHaveBeenCalledOnce();
  });

  it("allowed_push_host matches one of multiple registries fails", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0", {
        allowed_push_host: "https://rubygems.org",
      }),
    );
    fs.writeFileSync(
      path.join(workspace, ".github", "release-gems.yml"),
      "registries:\n- host: https://rubygems.org\n- host: https://gems.example.com\n",
    );

    await loadBuild();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("allowed_push_host"),
    );
  });

  it("allowed_push_host does not match the only registry fails", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0", {
        allowed_push_host: "https://gems.example.com",
      }),
    );

    await loadBuild();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("allowed_push_host"),
    );
    expect(mockUploadArtifact).not.toHaveBeenCalled();
  });

  it("allowed_push_host matches a non-default single registry succeeds", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0", {
        allowed_push_host: "https://gems.example.com",
      }),
    );
    fs.writeFileSync(
      path.join(workspace, ".github", "release-gems.yml"),
      "registries:\n- host: https://gems.example.com\n",
    );

    await loadBuild();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockUploadArtifact).toHaveBeenCalledOnce();
  });

  it("without sbom input, uploads only provenance attestation", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0"),
    );

    await loadBuild();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockAttest).not.toHaveBeenCalled();
    const files: string[] = mockUploadArtifact.mock.calls[0][1];
    const attestationFiles = files.filter((f) => f.endsWith(".sigstore.json"));
    expect(attestationFiles).toHaveLength(1);
    expect(attestationFiles[0]).toContain("provenance-");
  });

  it("with sbom input, attests SBOM and uploads two attestation files", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0"),
    );
    const sbomPath = path.join(workspace, "sbom.json");
    fs.writeFileSync(
      sbomPath,
      JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6" }),
    );

    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "github-token":
          return "gha-token";
        case "retention-days":
          return "";
        case "ruby":
          return "ruby";
        case "sbom":
          return sbomPath;
        default:
          return "";
      }
    });

    await loadBuild();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockAttest).toHaveBeenCalledOnce();
    expect(mockAttest).toHaveBeenCalledWith(
      expect.objectContaining({
        subjects: expect.arrayContaining([
          expect.objectContaining({ name: "foo-1.0.0.gem" }),
        ]),
        predicateType: "https://cyclonedx.org/bom/v1.6",
      }),
    );
    const files: string[] = mockUploadArtifact.mock.calls[0][1];
    const attestationFiles = files.filter((f) => f.endsWith(".sigstore.json"));
    expect(attestationFiles).toHaveLength(2);
    expect(
      attestationFiles.some((f) => path.basename(f).startsWith("provenance-")),
    ).toBe(true);
    expect(
      attestationFiles.some((f) => path.basename(f).startsWith("sbom-")),
    ).toBe(true);
  });

  it("retention-days string input is parsed as integer and passed to uploadArtifact", async () => {
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0"),
    );

    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "github-token":
          return "gha-token";
        case "retention-days":
          return "90";
        case "ruby":
          return "ruby";
        default:
          return "";
      }
    });

    await loadBuild();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockUploadArtifact).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.any(String),
      { retentionDays: 90 },
    );
  });

  it("per-gem prebuild hook receives gem environment variables", async () => {
    const hookOutputFile = path.join(workspace, "hook_output.txt");
    fs.writeFileSync(
      path.join(workspace, "foo.gemspec"),
      gemspecContent("foo", "1.0.0"),
    );
    fs.writeFileSync(
      path.join(workspace, ".github", "release-gems.yml"),
      [
        "gems:",
        "- gemspec: foo.gemspec",
        "  hooks:",
        `    prebuild: echo $RELEASE_GEMS_GEM_NAME > ${hookOutputFile}`,
      ].join("\n"),
    );

    await loadBuild();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(fs.readFileSync(hookOutputFile, "utf8").trim()).toBe("foo");
  });

  describe("verify-tag", () => {
    it("verified annotated tag passes", async () => {
      fs.writeFileSync(
        path.join(workspace, "foo.gemspec"),
        gemspecContent("foo", "1.0.0"),
      );
      process.env.GITHUB_REF = "refs/tags/v1.0.0";
      mockGetRef.mockResolvedValue({
        data: { object: { type: "tag", sha: "deadbeef" } },
      });
      mockGetTag.mockResolvedValue({
        data: { verification: { verified: true, reason: "valid" } },
      });

      await loadBuild();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockUploadArtifact).toHaveBeenCalledOnce();
    });

    it("lightweight tag fails", async () => {
      fs.writeFileSync(
        path.join(workspace, "foo.gemspec"),
        gemspecContent("foo", "1.0.0"),
      );
      process.env.GITHUB_REF = "refs/tags/v1.0.0";
      mockGetRef.mockResolvedValue({
        data: { object: { type: "commit", sha: "deadbeef" } },
      });

      await loadBuild();

      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining("is not an annotated tag"),
      );
      expect(mockUploadArtifact).not.toHaveBeenCalled();
    });

    it("unverified annotated tag fails", async () => {
      fs.writeFileSync(
        path.join(workspace, "foo.gemspec"),
        gemspecContent("foo", "1.0.0"),
      );
      process.env.GITHUB_REF = "refs/tags/v1.0.0";
      mockGetRef.mockResolvedValue({
        data: { object: { type: "tag", sha: "deadbeef" } },
      });
      mockGetTag.mockResolvedValue({
        data: { verification: { verified: false, reason: "unsigned" } },
      });

      await loadBuild();

      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining("signature verification failed: unsigned"),
      );
      expect(mockUploadArtifact).not.toHaveBeenCalled();
    });

    it("branch push skips signature check", async () => {
      fs.writeFileSync(
        path.join(workspace, "foo.gemspec"),
        gemspecContent("foo", "1.0.0"),
      );
      // GITHUB_REF defaults to "refs/heads/main" (set in beforeEach)

      await loadBuild();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockGetRef).not.toHaveBeenCalled();
      expect(mockGetTag).not.toHaveBeenCalled();
      expect(mockUploadArtifact).toHaveBeenCalledOnce();
    });

    it("verify-tag=false skips signature check", async () => {
      fs.writeFileSync(
        path.join(workspace, "foo.gemspec"),
        gemspecContent("foo", "1.0.0"),
      );
      process.env.GITHUB_REF = "refs/tags/v1.0.0";
      mockGetInput.mockImplementation((name: string) => {
        switch (name) {
          case "github-token":
            return "gha-token";
          case "verify-tag":
            return "false";
          default:
            return "";
        }
      });

      await loadBuild();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockGetRef).not.toHaveBeenCalled();
      expect(mockGetTag).not.toHaveBeenCalled();
      expect(mockUploadArtifact).toHaveBeenCalledOnce();
    });
  });

  describe("forked pull request", () => {
    function writeEventPayload(payload: object): void {
      const eventPath = path.join(workspace, "event.json");
      fs.writeFileSync(eventPath, JSON.stringify(payload));
      process.env.GITHUB_EVENT_NAME = "pull_request";
      process.env.GITHUB_EVENT_PATH = eventPath;
    }

    it("forked PR skips both attestations but still uploads artifact", async () => {
      fs.writeFileSync(
        path.join(workspace, "foo.gemspec"),
        gemspecContent("foo", "1.0.0"),
      );
      writeEventPayload({
        pull_request: {
          head: { repo: { full_name: "contributor/repo" } },
          base: { repo: { full_name: "owner/repo" } },
        },
      });

      await loadBuild();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockAttestProvenance).not.toHaveBeenCalled();
      expect(mockAttest).not.toHaveBeenCalled();
      expect(mockUploadArtifact).toHaveBeenCalledOnce();
      const files: string[] = mockUploadArtifact.mock.calls[0][1];
      expect(files.filter((f) => f.endsWith(".sigstore.json"))).toHaveLength(0);
    });

    it("same-repo PR still attests normally", async () => {
      fs.writeFileSync(
        path.join(workspace, "foo.gemspec"),
        gemspecContent("foo", "1.0.0"),
      );
      writeEventPayload({
        pull_request: {
          head: { repo: { full_name: "owner/repo" } },
          base: { repo: { full_name: "owner/repo" } },
        },
      });

      await loadBuild();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockAttestProvenance).toHaveBeenCalledOnce();
      expect(mockUploadArtifact).toHaveBeenCalledOnce();
      const files: string[] = mockUploadArtifact.mock.calls[0][1];
      expect(files.filter((f) => f.endsWith(".sigstore.json"))).toHaveLength(1);
    });

    it("forked PR with sbom input also skips SBOM attestation", async () => {
      fs.writeFileSync(
        path.join(workspace, "foo.gemspec"),
        gemspecContent("foo", "1.0.0"),
      );
      const sbomPath = path.join(workspace, "sbom.json");
      fs.writeFileSync(
        sbomPath,
        JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6" }),
      );
      writeEventPayload({
        pull_request: {
          head: { repo: { full_name: "contributor/repo" } },
          base: { repo: { full_name: "owner/repo" } },
        },
      });
      mockGetInput.mockImplementation((name: string) => {
        switch (name) {
          case "github-token":
            return "gha-token";
          case "ruby":
            return "ruby";
          case "sbom":
            return sbomPath;
          default:
            return "";
        }
      });

      await loadBuild();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockAttestProvenance).not.toHaveBeenCalled();
      expect(mockAttest).not.toHaveBeenCalled();
    });
  });
});
