import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as core from "@actions/core";
import * as yaml from "js-yaml";
import { z } from "zod";
import type { RegistryConfig } from "./config";

const ExchangeTokenResponseSchema = z.object({
  name: z.string(),
  rubygems_api_key: z.string(),
});

export const RUBYGEMS_ORG = "rubygems.org";

/**
 * Exchange a GitHub Actions OIDC token for a RubyGems.org short-lived API key
 * via the trusted publisher API.
 */
export async function exchangeOidcToken(aud = "rubygems.org"): Promise<string> {
  core.info(`Requesting for OIDC token (aud: ${aud})`);

  const oidcToken = await core.getIDToken(aud);

  core.info("Exchanging OIDC token with rubygems.org");

  const response = await fetch(
    "https://rubygems.org/api/v1/oidc/trusted_publisher/exchange_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ jwt: oidcToken }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to exchange OIDC token: HTTP ${response.status} - ${body}`,
    );
  }

  const json = await response.json();
  const result = ExchangeTokenResponseSchema.parse(json);
  core.setSecret(result.rubygems_api_key);

  core.info(`Credentials received: ${JSON.stringify(json)}`);

  return result.rubygems_api_key;
}

const GemCredentialsSchema = z.record(z.string(), z.string());

/**
 * Load gem credentials from the given credentials file path.
 */
export async function loadGemCredentials(
  credentialsPath = path.join(os.homedir(), ".gem", "credentials"),
): Promise<Record<string, string>> {
  let content: string;
  try {
    content = await fs.promises.readFile(credentialsPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Credentials file not found ${credentialsPath}`);
    }
    throw err;
  }

  const parsed = yaml.load(content);
  try {
    return GemCredentialsSchema.parse(parsed);
  } catch (_err) {
    throw new Error(`Invalid credentials file ${credentialsPath}`);
  }
}

/**
 * Push a gem to the given registry via its HTTP API.
 *
 * For rubygems.org: exchanges a GitHub Actions OIDC token for a short-lived
 * API key via the trusted publisher API.
 * For other registries: looks up the API key from the provided credentials record.
 *
 * Sends a multipart POST to /api/v1/gems with the gem binary and its Sigstore
 * attestation bundle. HTTP 409 (version already published) is treated as success.
 *
 * @param registry        Registry configuration.
 * @param gemPath         Path to the .gem file.
 * @param attestationPaths Paths to the .sigstore.json bundle files.
 * @param credentials     Credentials record loaded from ~/.gem/credentials.
 */
export async function pushToRegistry(
  registry: RegistryConfig,
  gemPath: string,
  attestationPaths: string[],
  credentials?: Record<string, string>,
): Promise<void> {
  let apiKey: string;
  if (new URL(registry.host).hostname === RUBYGEMS_ORG) {
    apiKey = await exchangeOidcToken();
  } else {
    const key = credentials?.[registry.host];
    if (!key) {
      throw new Error(
        `No credentials found for ${registry.host} in ~/.gem/credentials`,
      );
    }
    apiKey = key;
  }

  const body = new FormData();
  body.append(
    "gem",
    await fs.openAsBlob(gemPath, { type: "application/octet-stream" }),
    path.basename(gemPath),
  );

  body.append(
    "attestations",
    JSON.stringify(
      await Promise.all(
        attestationPaths.map(async (path) =>
          JSON.parse(await fs.promises.readFile(path, "utf8")),
        ),
      ),
    ),
  );

  core.info(`Uploading ${gemPath} to ${registry.host}`);

  const response = await fetch(apiUrl(registry, "api/v1/gems"), {
    method: "POST",
    headers: { Authorization: apiKey },
    body,
  });

  if (response.status === 409) {
    return;
  }

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Failed to push gem to ${registry.host}: HTTP ${response.status} - ${responseBody}`,
    );
  }

  core.info(`Uploaded ${gemPath} to ${registry.host}`);
}

function apiUrl({ host }: RegistryConfig, path: string): string {
  return new URL(`${host}/${path}`).toString();
}
