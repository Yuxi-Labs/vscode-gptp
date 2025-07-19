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
  "version": "1.0",
  "model": "gpt-4",
  "temperature": 0.7,
  "variables": [
    {
      "name": "variable1",
      "description": "What should the assistant explain?",
      "example": "quantum computing"
    }
  ],
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
