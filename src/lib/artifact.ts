import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { default as artifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import * as z from "zod";
import * as codec from "#/codec";
import type { Gemspec } from "#/gem";

// Update whenever making incompatible change to the semantics of the index.
const ARTIFACT_VERSION = "2026-03-19";

const FilenameSchema = z
  .string()
  .min(1)
  .regex(/^[^/]+$/, { message: "should not contain /" });

const GemArtifactIndexSchema = z.object({
  version: z.literal(ARTIFACT_VERSION),
  gem: z.object({
    filename: FilenameSchema,
  }),
  attestations: z.array(
    z.object({
      filename: FilenameSchema,
      mediaType: z.string(),
      sha256: z.string(),
    }),
  ),
});
const GemArtifactIndexJson = codec.json(GemArtifactIndexSchema);

export type GemArtifactIndex = z.infer<typeof GemArtifactIndexSchema>;

function parseGemArtifactIndex(json: string): GemArtifactIndex {
  try {
    return GemArtifactIndexJson.decode(json);
  } catch (cause) {
    if (
      cause instanceof z.core.$ZodError &&
      cause.issues.some((i) => i.path[0] === "version")
    ) {
      throw new Error(
        "Artifact schema mismatch. Ensure the build and publish actions are pinned to the same release.",
        { cause },
      );
    }
    throw new Error("Failed to parse artifact index", { cause });
  }
}

export async function uploadGemArtifact({
  gemspec,
  directory,
  index,
  retentionDays,
}: {
  gemspec: Gemspec;
  directory: string;
  index: Omit<GemArtifactIndex, "version">;
  retentionDays?: number;
}): Promise<void> {
  const artifactName = `release-gems-${gemspec.name}-${gemspec.platform}`;
  const indexPath = path.join(directory, "index.json");

  await fs.promises.writeFile(
    indexPath,
    GemArtifactIndexJson.encode({ version: ARTIFACT_VERSION, ...index }),
  );

  await artifactClient.uploadArtifact(
    artifactName,
    [
      indexPath,
      path.join(directory, index.gem.filename),
      ...index.attestations.map((attest) =>
        path.join(directory, attest.filename),
      ),
    ],
    directory,
    {
      retentionDays: retentionDays ?? 0, // 0 assumes default retention setting
    },
  );
}

/**
 * Download all release-gems-* artifacts for the current workflow run.
 * Returns paths to directories containing the downloaded files.
 */
export async function downloadGemArtifacts(): Promise<
  { directory: string; index: GemArtifactIndex }[]
> {
  const { artifacts } = await artifactClient.listArtifacts({ latest: true });

  const gemArtifacts = artifacts.filter((a) =>
    a.name.startsWith("release-gems-"),
  );
  core.debug(`artifacts to download: ${gemArtifacts}`);

  return Promise.all(
    gemArtifacts.map(async (artifact) => {
      const { downloadPath } = await artifactClient.downloadArtifact(
        artifact.id,
        {
          path: path.join(os.tmpdir(), `release-gems-dl-${artifact.id}`),
        },
      );
      if (downloadPath == null) throw new Error("Something went wrong");
      const index = parseGemArtifactIndex(
        await fs.promises.readFile(path.join(downloadPath, "index.json"), {
          encoding: "utf8",
        }),
      );

      if (!fs.existsSync(path.join(downloadPath, index.gem.filename))) {
        throw new Error(
          `Gem '${index.gem.filename}' does not exist in the downloaded artifact archive #${artifact.id} '${artifact.name}'`,
        );
      }
      for (const attestation of index.attestations) {
        if (!fs.existsSync(path.join(downloadPath, attestation.filename))) {
          throw new Error(
            `Attestation '${attestation.filename}' does not exist in the downloaded artifact archive #${artifact.id} '${artifact.name}'`,
          );
        }
      }

      return { directory: downloadPath, index };
    }),
  );
}
