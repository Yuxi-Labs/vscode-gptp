import * as vscode from 'vscode';

export function registerSnippets(): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	// Insert a basic .gptp scaffold
	const insertPromptScaffold = vscode.commands.registerCommand('gptp.insertPromptScaffold', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const scaffold = `{
  "name": "New Prompt",
  "description": "Describe your prompt here.",
  "model": "gpt-4",
  "temperature": 0.7,
  "input": {
    "variable1": "value"
  },
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Explain {{variable1}}."
    }
  ]
}`;
		editor.insertSnippet(new vscode.SnippetString(scaffold));
	});
	disposables.push(insertPromptScaffold);

	// Insert a message block
	const insertMessage = vscode.commands.registerCommand('gptp.insertMessageBlock', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const messageBlock = `{
  "role": "$1",
  "content": "$2"
}`;
		editor.insertSnippet(new vscode.SnippetString(messageBlock));
	});
	disposables.push(insertMessage);

	return disposables;
}
