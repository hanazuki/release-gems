# ChangeLog

## Unreleased

- Third-party registries: API keys are now read from `~/.gem/credentials` (the standard RubyGems credential store).

## v1.0.3 (2026-03-15)

- Add sbom input to attach an SBOM attestation to the build. It automatically detects CyclondDX and SPDX 2.x/3.x formats.
- Provenance attestation is now a single multi-subject bundle covering all the gems built in a job.

## v1.0.2 (2026-03-06)

- Moved to <https://github.com/release-gems/action>.

## v1.0.1 (2026-03-06)

## v1.0.0 (2026-03-06)

- Initial release
