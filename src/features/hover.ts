import * as vscode from 'vscode';

const HOVER_HELP: Record<string, string> = {
	"model": "`model` — The GPT model to use (e.g., `gpt-4`, `gpt-3.5-turbo`).",
	"temperature": "`temperature` — Controls randomness. Range: 0.0 (deterministic) to 1.0 (creative).",
	"messages": "`messages` — Array of message blocks forming the conversation history.",
	"role": "`role` — Message sender: one of `system`, `user`, or `assistant`.",
	"content": "`content` — The actual text of the message.",
	"name": "`name` — Optional identifier for the prompt.",
	"description": "`description` — Optional explanation or summary of the prompt.",
	"version": "`version` — The version of the .gptp format being used (e.g., `1.0`).",
	"system": "`system` — Instruction that sets assistant behavior (optional if included in messages).",
	"variables": "`variables` — List of user-provided input values the prompt can use.",
	"required": "`required` — If true, this variable must be supplied at runtime.",
	"example": "`example` — Example value shown for this variable.",
	"rendering": "`rendering` — Optional UI hints for tools displaying this prompt.",
	"instructions_position": "`instructions_position` — Controls where system instructions appear: `top`, `inline`, or `none`.",
	"style": "`style` — Display style for UI: `chat`, `single-shot`, or `template`.",
	"output_format": "`output_format` — Expected output style: `json`, `markdown`, `plain-text`, or `html`.",
	"metadata": "`metadata` — Optional data about the author, creation time, and model compatibility.",
	"created_by": "`created_by` — Author of this prompt.",
	"created_at": "`created_at` — ISO timestamp when the prompt was created.",
	"model_compatibility": "`model_compatibility` — List of compatible LLMs (e.g., `gpt-4`, `claude-3-opus`).",
	"tags": "`tags` — Freeform list of keyword labels for the prompt.",
	"extends": "`extends` — Path to another .gptp file this prompt builds upon."
};

export function registerHoverProvider(): vscode.Disposable {
	return vscode.languages.registerHoverProvider('gptp', {
		provideHover(document, position, token) {
			const range = document.getWordRangeAtPosition(position, /"[^"]+"/);
			if (!range) return;

			const key = document.getText(range).replace(/"/g, '');
			const doc = HOVER_HELP[key];
			if (doc) {
				return new vscode.Hover(new vscode.MarkdownString(doc));
			}
		}
	});
}
