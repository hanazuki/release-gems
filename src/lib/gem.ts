import * as path from "node:path";
import { z } from "zod";
import { runRuby } from "#/ruby";
import type { SandboxConfig } from "#/sandbox";

const GemspecSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  metadata: z.record(z.string(), z.string()),
});
export type Gemspec = z.infer<typeof GemspecSchema>;

export async function loadGemspec(
  ruby: string,
  gemspecPath: string,
  sandbox?: SandboxConfig,
): Promise<Gemspec> {
  const script = `\
require 'rubygems'
spec = Gem::Specification.load(ARGV[0]) or fail "Cannot load gemspec: #{ARGV[0]}"
return {
  name: spec.name,
  version: spec.version.to_s,
  platform: spec.platform,
  metadata: spec.respond_to?(:metadata) ? spec.metadata : {},
}
`;

  const absGemspecPath = path.resolve(gemspecPath);
  try {
    return await runRuby({
      ruby,
      cwd: path.dirname(absGemspecPath),
      script,
      args: [absGemspecPath],
      schema: GemspecSchema,
      sandbox,
    });
  } catch (cause) {
    throw new Error(`failed to inspect ${gemspecPath}`, { cause });
  }
}

const GemBuildResultSchema = z.object({
  path: z.string(),
});
export type GemBuildResult = z.infer<typeof GemBuildResultSchema>;

export async function buildGem(
  ruby: string,
  gemspecPath: string,
  outDir: string,
  sandbox?: SandboxConfig,
): Promise<GemBuildResult> {
  const script = `\
require 'rubygems'
require 'rubygems/package'
spec = Gem::Specification.load(ARGV[0]) or fail "Cannot load gemspec: #{ARGV[0]}"
gem_path = File.join(ARGV[1], spec.file_name)
Gem::Package.build(spec, false, false, gem_path)
return {path: gem_path}
`;

  const absGemspecPath = path.resolve(gemspecPath);
  try {
    return await runRuby({
      ruby,
      cwd: path.dirname(absGemspecPath),
      script,
      args: [absGemspecPath, path.resolve(outDir)],
      schema: GemBuildResultSchema,
      sandbox,
    });
  } catch (cause) {
    throw new Error(`failed to build gem from ${gemspecPath}`, { cause });
  }
}
