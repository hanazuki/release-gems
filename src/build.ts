import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  attest as attestGeneric,
  attestProvenance as attestProvenanceLib,
} from "@actions/attest";
import * as core from "@actions/core";
import * as github from "@actions/github";
import * as z from "zod";
import { uploadGemArtifact } from "./lib/artifact";
import {
  type HookConfig,
  loadConfigLocal,
  type RegistryConfig,
} from "./lib/config";
import { buildGem, type GemBuildResult, type Gemspec } from "./lib/gem";
import { runHook } from "./lib/hook";
import { BooleanSchema, getInputs, IntegerSchema } from "./lib/input";
import { resolveTargets, selectTargets, type Target } from "./lib/project";
import { loadSbom } from "./lib/sbom";
import { parseTag, verifyTag } from "./lib/tag";

const ATTESTATION_HASH_DIGITS = 8;

type BuildResult = GemBuildResult & {
  gemspec: Gemspec;
  sha256: string;
};
type Attestation = {
  name: string;
  bundle: Buffer;
  sha256: string;
};

async function build({
  target,
  ruby,
}: {
  target: Target;
  ruby: string;
}): Promise<BuildResult> {
  const gemDir = path.dirname(target.gemspecPath);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-gems-"));
  const hookEnv = {
    RELEASE_GEMS_GEM_NAME: target.gemspec.name,
    RELEASE_GEMS_GEM_VERSION: target.gemspec.version,
    RELEASE_GEMS_GEMSPEC_PATH: target.gemspecPath,
  };

  await core.group(`Run prebuild hook for ${target.gemspec.name}`, async () =>
    runHook(target.gemConfig.hooks?.prebuild, gemDir, hookEnv),
  );

  const result = await core.group(`Pack ${target.gemspec.name}`, async () => {
    return buildGem(ruby, target.gemspecPath, outDir);
  });

  await core.group(`Run postbuild hook for ${target.gemspec.name}`, async () =>
    runHook(target.gemConfig.hooks?.postbuild, gemDir, hookEnv),
  );

  const sha256 = sha256hex(await fs.promises.readFile(result.path));
  return { ...result, gemspec: target.gemspec, sha256 };
}

async function* buildTargets({
  globalHooks,
  workspace,
  targets,
  ruby,
}: {
  globalHooks: HookConfig | undefined;
  workspace: string;
  targets: Target[];
  ruby: string;
}): AsyncGenerator<BuildResult> {
  await core.group("Run global prebuild hook", async () =>
    runHook(globalHooks?.prebuild, workspace),
  );

  for (const target of targets) {
    yield await build({ target, ruby });
  }

  await core.group("Run global postbuild hook", async () =>
    runHook(globalHooks?.postbuild, workspace),
  );
}

async function uploadArtifacts({
  results,
  attestations,
  retentionDays,
}: {
  results: BuildResult[];
  attestations: Attestation[];
  retentionDays: number | undefined;
}): Promise<void> {
  await Promise.all(
    results.map(async (result) => {
      const directory = path.dirname(result.path);

      const attestationIndex = await Promise.all(
        attestations.map(async (attestation) => {
          const hash = attestation.sha256.slice(0, ATTESTATION_HASH_DIGITS);
          const filename = `${attestation.name}-${hash}.sigstore.json`;
          await fs.promises.writeFile(
            path.join(directory, filename),
            attestation.bundle,
          );
          return {
            filename,
            mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
            sha256: attestation.sha256,
          };
        }),
      );

      const index = {
        gem: {
          filename: path.relative(directory, result.path),
        },
        attestations: attestationIndex,
      };

      return uploadGemArtifact({
        gemspec: result.gemspec,
        directory,
        index,
        retentionDays,
      });
    }),
  );
}

function checkAllowedPushHosts(
  targets: Target[],
  registries: RegistryConfig[],
): void {
  for (const target of targets) {
    const allowedPushHost = target.gemspec.metadata.allowed_push_host;
    if (allowedPushHost === undefined) continue;

    const allowedHost = new URL(allowedPushHost).host;
    const mismatched = registries.filter(
      (r) => new URL(r.host).host !== allowedHost,
    );
    if (mismatched.length > 0) {
      throw new Error(
        `Gem ${target.gemspec.name} has allowed_push_host '${allowedPushHost}' but configured to push to ${mismatched.map((r) => `'${r.host}'`).join(", ")}`,
      );
    }
  }
}

function sha256hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

type Subject = { name: string; digest: { sha256: string } };

async function attestProvenance({
  subjects,
  token,
}: {
  subjects: Subject[];
  token: string;
}): Promise<Attestation> {
  core.info(`subjects: ${JSON.stringify(subjects)}`);

  const attestation = await attestProvenanceLib({ subjects, token });

  core.info(`attestationID: ${attestation.attestationID}`);
  core.info(`tlogID: ${attestation.tlogID}`);

  const bundle = Buffer.from(JSON.stringify(attestation.bundle));
  const sha256 = sha256hex(bundle);
  return { name: "provenance", bundle, sha256 };
}

async function attestSbom({
  subjects,
  sbomPath,
  predicateTypeOverride,
  token,
}: {
  subjects: Subject[];
  sbomPath: string;
  predicateTypeOverride: string | undefined;
  token: string;
}): Promise<Attestation> {
  const { predicate, predicateType } = await loadSbom(
    sbomPath,
    predicateTypeOverride,
  );
  const attestation = await attestGeneric({
    subjects,
    predicateType,
    predicate,
    token,
  });

  core.info(`attestationID: ${attestation.attestationID}`);
  core.info(`tlogID: ${attestation.tlogID}`);

  const bundle = Buffer.from(JSON.stringify(attestation.bundle));
  const sha256 = sha256hex(bundle);
  return { name: "sbom", bundle, sha256 };
}

async function run(): Promise<void> {
  const {
    "github-token": token,
    "retention-days": retentionDays,
    ruby,
    sbom: sbomPath,
    "sbom-predicate-type": predicateTypeOverride,
    "verify-tag": verifyTagInput,
  } = getInputs({
    "github-token": z.string(),
    "retention-days": IntegerSchema.optional(),
    ruby: z.string().default("ruby"),
    sbom: z.string().optional(),
    "sbom-predicate-type": z.string().optional(),
    "verify-tag": BooleanSchema.default("true"),
  });

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const config = await loadConfigLocal(workspace);
  const tagInfo = parseTag(github.context.ref);

  if (verifyTagInput && tagInfo !== null) {
    const octokit = github.getOctokit(token);
    await verifyTag({
      octokit,
      repo: github.context.repo,
      tagName: tagInfo.tagName,
    });
  }

  const candidates = await resolveTargets(workspace, config, ruby);
  const targets = selectTargets(candidates, tagInfo);
  checkAllowedPushHosts(targets, config.registries);
  const results = await Array.fromAsync(
    buildTargets({
      globalHooks: config.hooks,
      workspace,
      targets,
      ruby,
    }),
  );

  const subjects = results.map((r) => ({
    name: path.basename(r.path),
    digest: { sha256: r.sha256 },
  }));

  const attestations: Attestation[] = [];

  const isFork =
    github.context.eventName === "pull_request" &&
    github.context.payload.pull_request?.head?.repo?.full_name !==
      github.context.payload.pull_request?.base?.repo?.full_name;

  if (isFork) {
    core.info("Attestation skipped: pull request from a forked repository.");
  } else {
    attestations.push(
      await core.group("Attest provenance", async () =>
        attestProvenance({ subjects, token }),
      ),
    );

    if (sbomPath != null) {
      attestations.push(
        await core.group("Attest SBOM", async () =>
          attestSbom({
            subjects,
            sbomPath,
            predicateTypeOverride,
            token,
          }),
        ),
      );
    }
  }

  await core.group("Upload artifacts", async () => {
    await uploadArtifacts({
      results,
      attestations,
      retentionDays,
    });
  });
}

export const completed = run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
