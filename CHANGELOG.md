# Change Log

All notable changes to the "vscode-gptp" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- TBD

## [0.2.5] - 2025-10-05

### Fixed
- Snippet definitions: removed nested placeholders and escaped `$` to prevent snippet-variable confusion warnings.
- Editor responsiveness: editing-time validation now uses fast local checks; SDK imports are used only for explicit run/migrate/diff commands.
- Added `gptp.autoDetectPasted` setting (default: false) to avoid scanning non-GPTP documents; enabling it restores auto-detection for pasted/opened content.

### Changed
- Minor internal refactors to reduce extension host stalls in test environments.

## [0.2.0] - 2025-09-07

### Added
- Docs: quickstart and commands references under `docs/`.
- Examples: `docs/examples/hello-world.gptp`, `faq-football.gptp`, `email-drafter.gptp`.
- README: “Run with Model” behavior explained; links to new docs and examples.

### Changed
- Build scripts simplified; removed scripts TS build step.
- Settings text clarified for optional HTTP fallback (provider‑agnostic).

### Removed
- All LM Studio references and runner script.

## [0.1.0] - 2025-08-XX

- Initial release