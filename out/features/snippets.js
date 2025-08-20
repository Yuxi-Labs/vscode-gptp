import * as vscode from 'vscode';
export function registerSnippets() {
    const disposables = [];
    // Insert a basic .gptp scaffold
    const insertPromptScaffold = vscode.commands.registerCommand('gptp.insertPromptScaffold', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const scaffold = `{
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
}`;
        editor.insertSnippet(new vscode.SnippetString(scaffold));
    });
    disposables.push(insertPromptScaffold);
    // Insert a message block
    const insertMessage = vscode.commands.registerCommand('gptp.insertMessageBlock', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const messageBlock = `{
  "role": "$1",
  "content": "$2"
}`;
        editor.insertSnippet(new vscode.SnippetString(messageBlock));
    });
    disposables.push(insertMessage);
    return disposables;
}
//# sourceMappingURL=snippets.js.map