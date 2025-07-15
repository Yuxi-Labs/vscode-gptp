import * as vscode from 'vscode';

const HOVER_HELP: Record<string, string> = {
	"model": "`model` — The GPT model to use (e.g., `gpt-4`, `gpt-3.5-turbo`).",
	"temperature": "`temperature` — Controls randomness. Range: 0.0 (deterministic) to 1.0 (creative).",
	"messages": "`messages` — Array of message blocks forming the conversation history.",
	"role": "`role` — Message sender: one of `system`, `user`, or `assistant`.",
	"content": "`content` — The actual text of the message.",
	"name": "`name` — Optional identifier for the prompt.",
	"description": "`description` — Optional explanation or summary of the prompt."
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
