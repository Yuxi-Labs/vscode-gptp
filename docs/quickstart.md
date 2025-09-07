# GPTP Quickstart

This guide shows how to get productive with the GPT Prompt (GPTP) extension in minutes.

## Install the extension

- From VSIX: build or download `vscode-gptp-<version>.vsix`, then use “Install from VSIX…” in the Extensions view.
- From source: open this repo in VS Code and press F5 to launch the Extension Development Host.

## Create a prompt

Use the command palette (Ctrl/Cmd+Shift+P):

- New GPT Prompt File — inserts a v1.2.0 scaffold you can edit right away.

## Validate and preview

- GPTP: Validate Current Prompt — checks your document against GPTP v1.2.0 and shows issues in Problems.
- GPTP: Execute Preview (Resolved Messages) — shows the final messages after variable interpolation (no provider calls).

## Run with a model

- GPTP: Run with Model — prompts for required variables, runs via the GPTP Core SDK, then opens a Markdown tab with:
  - resolvedMessages (JSON)
  - modelOutput (formatted)

The tab is unsaved; save it to persist results.

## Settings

Search for “GPTP” in Settings to configure:
- Validate before run
- Timeout (ms)
- Retry policy (retries, base/max delay, jitter)
- Optional HTTP fallback (OpenAI‑compatible). Disabled by default.
