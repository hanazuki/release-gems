# Project structure

- src/ - TypeScript sources
  - build.ts - Entrypoint for build action
  - publish.ts - Entrypoint for publish action
  - lib/ - Internal library
    - artifact.ts - Upload and download Actions artifacts to pass artifacts between build and publish actions
    - config.ts - Parse release-gems.yml
    - gem.ts - Read *.gemspec and build gems
    - hook.ts - Run hooks
    - input.ts - Read GitHub action input
    - project.ts - Find gems to build
    - registry.ts - Communicate with RubyGems.org and compatible gem servers
    - release.ts - Create and update GitHub Releases
    - ruby.ts - Run Ruby scrits from TypeScript
    - tag.ts - Manage git tags
- build/action.yml - Definition for build action
- publish/action.yml - Definition for publish action
