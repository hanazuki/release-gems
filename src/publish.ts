import * as path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import * as z from "zod";
import { downloadGemArtifacts, type GemArtifactIndex } from "#/artifact";
import { loadConfig } from "#/config";
import { formatError } from "#/error";
import { getInputs } from "#/input";
import { loadGemCredentials, pushToRegistry, RUBYGEMS_ORG } from "#/registry";
import * as rel from "#/release";
import { fetchMessage, parseTag, type TagInfo } from "#/tag";

type Octokit = ReturnType<typeof github.getOctokit>;

async function composeRelease(
  tagInfo: TagInfo,
  octokit: Octokit,
  repo: { owner: string; repo: string },
): Promise<{ name: string; body: string }> {
  const { tagName } = tagInfo;
  const message = fetchMessage({ octokit, repo, tagName });

  const name =
    tagInfo.kind === "unified"
      ? `v${tagInfo.version}`
      : `${tagInfo.gemName} v${tagInfo.version}`;
  return { name, body: (await message) ?? `Release ${name}` };
}

function collectReleaseAssets(
  artifacts: { directory: string; index: GemArtifactIndex }[],
): Map<string, { path: string; mediaType: string }> {
  const files = new Map<string, { path: string; mediaType: string }>();
  // Dedupe by filename. Assets with the same filename has the same content (enforced by validateIndices).
  for (const { directory, index } of artifacts) {
    files.set(index.gem.filename, {
      path: path.join(directory, index.gem.filename),
      mediaType: "application/octet-stream",
    });
    for (const attestation of index.attestations) {
      files.set(attestation.filename, {
        path: path.join(directory, attestation.filename),
        mediaType: attestation.mediaType,
      });
    }
  }
  return files;
}

async function pushToRelease({
  octokit,
  repo,
  release,
  artifacts,
}: {
  octokit: Octokit;
  repo: { owner: string; repo: string };
  release: rel.Release;
  artifacts: { directory: string; index: GemArtifactIndex }[];
}) {
  const files = collectReleaseAssets(artifacts);

  return Promise.all(
    Array.from(files, ([filename, { path, mediaType }]) =>
      rel.uploadAsset({
        octokit,
        repo,
        release,
        name: filename,
        assetPath: path,
        mediaType,
      }),
    ),
  );
}

function validateIndices(artifacts: { index: GemArtifactIndex }[]): void {
  const gemFilenames = new Set<string>();
  const attestationSums = new Map<string, string>(); // filename => sha256
  for (const {
    index: { gem, attestations },
  } of artifacts) {
    if (!gem.filename.endsWith(".gem")) {
      throw new Error(
        `Gem filename should have .gem suffix: '${gem.filename}'`,
      );
    }

    if (gemFilenames.has(gem.filename)) {
      throw new Error(`Duplicate gem files in artifacts: '${gem.filename}'`);
    }
    gemFilenames.add(gem.filename);

    for (const { filename, sha256 } of attestations) {
      if (!filename.endsWith(".json")) {
        throw new Error(
          `Attestation filename should have .json suffix: '${filename}'`,
        );
      }

      const existing = attestationSums.get(filename);
      if (existing !== undefined && existing !== sha256) {
        throw new Error(
          `Conflicting attestation files in artifacts: '${filename}'`,
        );
      }
      attestationSums.set(filename, sha256);
    }
  }
}

async function run(): Promise<void> {
  const { "github-token": token } = getInputs({
    "github-token": z.string(),
  });

  const tagInfo = parseTag(github.context.ref);
  if (tagInfo === null) {
    throw new Error("publish action must be triggered by a tag push");
  }

  const octokit = github.getOctokit(token);
  const repo = github.context.repo;

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const [releaseNote, config] = await Promise.all([
    composeRelease(tagInfo, octokit, repo),
    loadConfig(workspace, github.context, octokit),
  ]);
  const registries = config.registries;

  const artifacts = await core.group("Download gem artifacts", async () =>
    downloadGemArtifacts(),
  );
  validateIndices(artifacts);

  await core.group("Publish to GitHub Releases", async () => {
    const release = await rel.getOrCreate({
      octokit,
      repo,
      tag: tagInfo,
      ...releaseNote,
    });
    if (release.draft) {
      await pushToRelease({ octokit, repo, release, artifacts });
      const finalized = await rel.finalize({ octokit, repo, release });
      if (!finalized.immutable) {
        core.warning(
          "Immutable releases are not enabled for this repository. " +
            "Enable them in repository settings to strengthen supply-chain security.",
        );
      }
    }
  });

  const hasThirdPartyRegistries = registries.some(
    (r) => new URL(r.host).hostname !== RUBYGEMS_ORG,
  );
  const credentials = hasThirdPartyRegistries
    ? await loadGemCredentials()
    : undefined;

  for (const registry of registries) {
    await core.group(`Publish to ${registry.host}`, async () => {
      for (const { directory, index } of artifacts) {
        await pushToRegistry(
          registry,
          path.join(directory, index.gem.filename),
          index.attestations.map(({ filename }) =>
            path.join(directory, filename),
          ),
          credentials,
        );
      }
    });
  }
}

export const completed = run().catch((err) => {
  core.setFailed(formatError(err));
});

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("collectReleaseAssets", () => {
    it("deduplicates shared attestation files across artifacts", () => {
      const artifacts = [
        {
          directory: "/dl/artifact-1",
          index: {
            gem: { filename: "foo-1.0.0-x86_64-linux.gem" },
            attestations: [
              {
                filename: "provenance-deadbeef.sigstore.json",
                mediaType: "application/json",
                sha256:
                  "deadbeef00000000000000000000000000000000000000000000000000000000",
              },
            ],
          },
        },
        {
          directory: "/dl/artifact-2",
          index: {
            gem: { filename: "foo-1.0.0-arm64-linux.gem" },
            attestations: [
              {
                filename: "provenance-deadbeef.sigstore.json",
                mediaType: "application/json",
                sha256:
                  "deadbeef00000000000000000000000000000000000000000000000000000000",
              },
            ],
          },
        },
      ];

      const files = collectReleaseAssets(artifacts);

      // Two distinct gem files + one deduplicated attestation = 3 total
      expect(files.size).toBe(3);
      expect(files.has("foo-1.0.0-x86_64-linux.gem")).toBe(true);
      expect(files.has("foo-1.0.0-arm64-linux.gem")).toBe(true);
      expect(files.has("provenance-deadbeef.sigstore.json")).toBe(true);
    });
  });
}
