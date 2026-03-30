# release-gems

**release-gems** is a GitHub action that automates the release workflow for Ruby gems: building, attesting provenance, and publishing to RubyGems.org and other registries with minimal configuration.

- No dependency on Bundler or Rake (so no need for `bundle install`); reduces supply-chain risks in the release process.
- Separate steps for building and publishing to minimize permission scope.
- Building gems in execution sandboxes. Sandbox blocks access to secret materials and network.
- Integration with GitHub releases: gems are also uploaded to a GitHub release, where GitHub generates a release attestation. Release attestations can independently verify the package registry or a package cache is not tampered with.

## Prerequisites

- The `build` action requires Ruby to be available on the runner (e.g. via [ruby/setup-ruby@v1](https://github.com/ruby/setup-ruby)). The three latest major versions of Ruby are tested.
- For publishing to RubyGems.org: create an environment (say `rubygems.org`) in your GitHub repository, and configure the environment as a [trusted publisher](https://docs.rubygems.org/trusted-publishers/) on RubyGems.org.
- The release environment and the release tags should be [protected](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment#deployment-protection-rules) to prevent unauthorized releases.
- Enable [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) to obtain release attestations.

## Quick Start

Add the following workflow to `.github/workflows/main.yml`:

```yaml
on:
  push:
    branches: [master]
    tags: ["v*"]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read  # To check out the repository
      id-token: write  # To obtain an ID token to sign attestation
      attestations: write  # To store the attestations on GitHub
    steps:
    - name: Install bubblewrap
      run: |
        sudo apt-get update && sudo apt-get install -y bubblewrap apparmor-profiles
        sudo ln -s /usr/share/apparmor/extra-profiles/bwrap-userns-restrict /etc/apparmor.d/
        sudo systemctl reload apparmor
    - uses: actions/checkout@v4
      with:
        persist-credentials: false
    - uses: ruby/setup-ruby@v1
      with:
        ruby-version: ruby
    - uses: release-gems/action/build@HASH
      with:
        sandbox: bubblewrap

  publish:
    if: startsWith(github.ref, 'refs/tags/')
    needs: [build]
    environment: rubygems.org
    runs-on: ubuntu-slim
    permissions:
      contents: write  # To create a GitHub release and publish assets
      id-token: write  # To obtain an ID token to log in RubyGems.org as a trusted publisher
    steps:
    - uses: release-gems/action/publish@HASH
```

Replace `HASH` with the commit SHA or tag of the release-gems release you want to pin to. Because this repository releases actions as immutable releases, pinning to a tag is as safe as pinning to a commit hash, unless GitHub as a platform is compromised.

## Releasing

Push a tag to trigger a release:

```sh
git tag -s v1.2.0
git push origin v1.2.0
```

The `build` job builds the gem and attests the build provenance. The `publish` job creates a GitHub release and pushes the gem to RubyGems.org.

The gem version in your `.gemspec` must match the tag version (`v1.2.0` → `1.2.0`). A mismatch fails the build.

## Configuration

For advanced setups, create `.github/release-gems.yml`:

```yaml
gems:
- directory: .        # path relative to repo root (default: .)
  gemspec: foo.gemspec  # auto-detected if omitted and exactly one .gemspec exists
  hooks:
    prebuild: bundle exec rake generate
    postbuild: shell command
hooks:                # global hooks, run once around the entire build
  prebuild: shell command
  postbuild: shell command
registries:           # defaults to rubygems.org if omitted
- host: https://rubygems.org
```

All fields are optional. The config file itself is optional for single-gem repositories.

## Action Inputs

### `build`

| Input | Default | Description |
|---|---|---|
| `github-token` | `secrets.GITHUB_TOKEN` | Token for uploading artifacts and creating attestations. |
| `retention-days` | GitHub account default | Artifact retention period in days. |
| `ruby` | `ruby` | Path or name of the Ruby binary. |
| `sbom` | (none) | Path to an SBOM file to attach. If omitted, no SBOM attestation is created. Supported formats: CycloneDX JSON, SPDX 2.x JSON, SPDX 3.x JSON-LD. |
| `sbom-predicate-type` | (auto-detected) | in-toto predicate type URI for the SBOM attestation. Provide this for formats that cannot be auto-detected. |
| `verify-tag` | `true` | If true, requires the triggering tag to be an annotated tag with a signature verified by GitHub. |
| `sandbox` | `false` | If set to `bubblewrap`, gem builds and hooks run inside a bubblewrap sandbox. Prevents subprocesses from accessing secrets via `/proc` or privilege escalation. Requires bubblewrap on the runner (e.g. `apt-get install bubblewrap`). |
| `sandbox-isolate-network` | `true` | When sandboxing is enabled, if true, unshares the network namespace, blocking all network access inside the sandbox. |
| `sandbox-writable-paths` | (none) | When sandboxing is enabled, a newline-separated list of absolute paths to mount as writable inside the sandbox. Blank lines are ignored. |

### `publish`

| Input | Default | Description |
|---|---|---|
| `github-token` | `secrets.GITHUB_TOKEN` | Token for downloading artifacts and managing GitHub releases. |

## Monorepo with per-gem versioning

For repositories with multiple gems, list each gem under `gems:`. Each gem can be released independently using per-gem tags:

```sh
git tag my-gem/v1.0.0
git push origin my-gem/v1.0.0
```

This builds and releases only `my-gem`, leaving other gems untouched.

To support per-gem tags, update your workflow trigger:

```yaml
on:
  push:
    tags: ["*/v*"]
```

## Publishing to a private gem server

To push to a registry other than RubyGems.org, add it under `registries:` in `.github/release-gems.yml`:

```yaml
registries:
- host: https://gems.example.com
```

The action reads the API key from a YAML file at `~/.gem/credentials` on the runner, using the `host` URL as the lookup key. Write the credentials file in your publish job before the release-gems step:

```yaml
publish:
  # ...
  steps:
  - name: Set up gem credentials
    run: |
      mkdir -p ~/.gem
      (umask 0077 && echo "https://gems.example.com: $API_KEY" > ~/.gem/credentials)
    env:
      API_KEY: ${{ secrets.PRIVATE_REGISTRY_API_KEY }}
  - uses: release-gems/action@HASH
```

Store the API key as a secret in your GitHub repository or environment (`PRIVATE_REGISTRY_API_KEY` in the example). The `host` value in `release-gems.yml` must match the key in `~/.gem/credentials` exactly, including scheme and trailing slash.

To publish to multiple registries, list them all under `registries:` and write a credentials entry for each.
