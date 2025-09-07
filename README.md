# GPT Prompt (GPTP) for VS Code

<p>
  <img src="https://img.shields.io/github/actions/workflow/status/Yuxi-Labs/vscode-gptp/continuous-integration.yml?branch=release%2Fv0.2.0" alt="Build Status" />
  <img src="https://img.shields.io/github/v/release/Yuxi-Labs/vscode-gptp?include_prereleases&sort=semver" alt="Latest Release" />
  <img src="https://img.shields.io/github/issues/Yuxi-Labs/vscode-gptp" alt="Open Issues" />
  <img src="https://img.shields.io/github/issues-pr/Yuxi-Labs/vscode-gptp" alt="Pull Requests" />
  <img src="https://img.shields.io/github/last-commit/Yuxi-Labs/vscode-gptp" alt="Last Commit" />
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="License: MIT" />
</p>

GPT Prompt (GPTP) adds first-class editing support for GPTP files in VS Code. It brings schema-aware validation, helpful diagnostics, completions, hovers, and handy commands so you can author prompts quickly and confidently. The extension targets GPTP schema v1.2.0 and includes an offline schema fallback so validation works even without network access.

• New to GPTP here? See the Quickstart in docs/quickstart.md and ready-to-run examples in docs/examples/.

## Installation

There are two common ways to install the extension:

1) From a packaged VSIX

- Build or download `vscode-gptp-<version>.vsix`.
- In VS Code, open the Extensions view, select the “…” menu, and choose “Install from VSIX…”.
- Pick the VSIX file and reload when prompted.

2) From source (Extension Development Host)

- Clone this repository and open it in VS Code.
- Press F5 (or use “Run and Debug” → “Run Extension”) to launch a sandboxed window with the extension loaded.

## What you get in the editor

When you open a `.gptp` file (or paste valid GPTP JSON), the language mode switches to “GPT Prompt” and the following features light up:

- Syntax highlighting for JSON with an injection that highlights `{{variables}}` inside strings.
- JSON schema validation against GPTP v1.2.0. The extension uses the official schema URL by default and falls back to a bundled copy when offline. Validation results include precise ranges and human-friendly messages.
- Completions for message roles (`system`, `user`, `assistant`) and for `{{variable}}` placeholders once variables are declared.
- Hover tooltips for core keys and variables to give you quick context without leaving the editor.
- Diagnostics beyond the schema, such as “variable used but not declared” and “variable declared but not used,” plus quick fixes to add, replace, or remove variables.

## Getting started

Create a new GPTP document using the built‑in command “New GPT Prompt File” or paste a minimal GPTP v1.2.0 document like this:

```json
{
  "$doctype": "gptp",
  "schemaVersion": "1.2.0",
  "promptVersion": "1.0.0",
  "title": "New Prompt",
  "description": "Describe what this prompt does.",
  "system": "You are a helpful assistant.",
  "variables": [
    { "name": "topic", "description": "Topic to explain", "required": true, "example": "quantum computing" }
  ],
  "messages": [
    { "role": "user", "content": "Explain {{topic}}." }
  ],
  "output_format": "markdown"
}
```

As you type, the Problems panel will surface issues from the schema and semantic checks. Try referencing a variable that hasn’t been declared or declaring one you don’t use to see quick fixes in action.

## Run with Model: what you’ll see

When you run “GPTP: Run with Model,” the extension:

- Prompts you only for required variables (with an option to reuse the last inputs).
- Executes via the GPTP Core SDK (no network calls for preview-only; provider calls when running with a configured provider).
- Opens a new, unsaved Markdown tab that shows:
  - resolvedMessages (JSON) — the final messages after variable interpolation
  - modelOutput (formatted) — formatted output according to the prompt’s output_format, when possible

Nothing is written to disk unless you save that tab.

To tweak behavior, open Settings and search for “GPTP” to configure validation-before-run, timeout, retry policy, and optional HTTP fallback to an OpenAI‑compatible endpoint (disabled by default).

## Examples

Open any of these examples from docs/examples/ and try “GPTP: Validate,” “GPTP: Execute Preview,” and “GPTP: Run with Model”:

- docs/examples/hello-world.gptp — Minimal prompt with one variable
- docs/examples/faq-football.gptp — Produces a neutral FAQ (5 Q&A)
- docs/examples/email-drafter.gptp — Drafts a concise email with tone control

If you want to create your own, use “New GPT Prompt File” to insert a v1.2.0 scaffold.



The command palette (Ctrl/Cmd+Shift+P) provides several helpful actions while authoring:
### Run with Model settings and reuse

- Open Settings and search for "GPTP" to configure:
  - Validate before run
  - Timeout (ms)
  - Retry policy: retries, base/max delay, jitter
  - Optional lockfile path

- When you run "GPTP: Run with Model" again on the same file, you can choose:
  - Run again with last inputs (reuses your previous variables)
  - Enter inputs… (prompt for required variables)
- New GPT Prompt File: Creates a new v1.2.0 scaffold in the current editor.
- GPTP: Validate Current Prompt: Runs validation and summarizes results.
- GPTP: Execute Preview (Resolved Messages): Resolves variables and shows a preview of messages alongside a mock model output (no remote calls).
- GPTP: Migrate Prompt to v1.2.0: Upgrades older GPTP documents to the v1.2.0 shape.
- GPTP: Diff Prompt Keys (2 open docs): Compares the top‑level keys between two open GPTP files.

You’ll also find two insertion helpers:

- GPTP: Insert Prompt Scaffold
- GPTP: Insert Message Block

## Validation and offline behavior

The extension validates GPTP files using the GPTP Core SDK first. If the network schema can’t be reached, it automatically falls back to a bundled v1.2.0 schema so you still get errors and warnings with precise ranges. Validation messages reference JSON Pointers internally, which the extension maps to the right spans in the document.

## Tips and troubleshooting

- The language mode should be “GPT Prompt” for all features to be active. The extension will switch files ending in `.gptp` automatically, and will also try to switch if pasted content clearly looks like GPTP (`$doctype: "gptp"`, a `schemaVersion`, and a `messages` array).
- If completions or hovers don’t appear, ensure there are no syntax errors first—JSON parse errors can suppress downstream features until fixed.
- If schema validation seems offline, check the Problems panel. The extension will automatically use the bundled schema if the network schema can’t be fetched.
- “Execute Preview” is a safe preview: it resolves variables but does not contact a model endpoint.

## Developing and packaging

- Build and typecheck using the project scripts; the output is emitted to `dist/` and includes the offline schema.
- To package a VSIX from source, use the standard VS Code extension packaging workflow. After packaging, you can install the `.vsix` file into any VS Code instance and validate the editing experience end‑to‑end.

Additional docs:

- docs/quickstart.md — fast path to install and run
- docs/commands.md — list of commands and what they do

## Security and privacy

This extension performs local validation and inspection of your GPTP files. It does not transmit prompt contents to external services as part of the editor features. The “Execute Preview” command runs locally against the SDK in a non‑running mode (preview only).

## License

MIT © 2025 William Sawyerr. See `LICENSE.md` for details.

## Changelog

For notable changes, see `CHANGELOG.md`.
