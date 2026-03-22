# ChangeLog

## Unreleased

- Attestation is automatically skipped when the build action runs in a pull request from a forked repository.
- Build action now verifies by default that the triggering tag is an annotated tag with a GitHub-verified signature (Opt out by setting `verify-tag: false`).
- Third-party registries: API keys are now read from `~/.gem/credentials` (the standard RubyGems credential store).

## v1.0.3 (2026-03-15)

- Add sbom input to attach an SBOM attestation to the build. It automatically detects CyclondDX and SPDX 2.x/3.x formats.
- Provenance attestation is now a single multi-subject bundle covering all the gems built in a job.

## v1.0.2 (2026-03-06)

- Moved to <https://github.com/release-gems/action>.

## v1.0.1 (2026-03-06)

## v1.0.0 (2026-03-06)

- Initial release
