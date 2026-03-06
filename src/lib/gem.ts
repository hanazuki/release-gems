import * as path from "node:path";
import { z } from "zod";
import { runRuby } from "./ruby";

const GemspecSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  metadata: z.record(z.string()),
});
export type Gemspec = z.infer<typeof GemspecSchema>;

export function loadGemspec(ruby: string, gemspecPath: string): Gemspec {
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
    return runRuby({
      ruby,
      cwd: path.dirname(absGemspecPath),
      script,
      args: [absGemspecPath],
      schema: GemspecSchema,
    });
  } catch (err) {
    throw new Error(`failed to inspect ${gemspecPath}`, { cause: err });
  }
}

const GemBuildResultSchema = z.object({
  path: z.string(),
});
export type GemBuildResult = z.infer<typeof GemBuildResultSchema>;

export function buildGem(
  ruby: string,
  gemspecPath: string,
  outDir: string,
): GemBuildResult {
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
    return runRuby({
      ruby,
      cwd: path.dirname(absGemspecPath),
      script,
      args: [absGemspecPath, path.resolve(outDir)],
      schema: GemBuildResultSchema,
    });
  } catch (err) {
    throw new Error(`failed to build gem from ${gemspecPath}`, { cause: err });
  }
}
