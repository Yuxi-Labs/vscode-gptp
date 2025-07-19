import * as vscode from 'vscode';

export function registerCompletions(): vscode.Disposable {
	return vscode.languages.registerCompletionItemProvider(
		'gptp',
		{
			provideCompletionItems(
				doc: vscode.TextDocument,
				pos: vscode.Position
			): vscode.CompletionItem[] {
				const systemItem = new vscode.CompletionItem('system', vscode.CompletionItemKind.Keyword);
				systemItem.documentation = new vscode.MarkdownString('`system` — Sets the behavior, tone, or constraints of the assistant.');

				const userItem = new vscode.CompletionItem('user', vscode.CompletionItemKind.Keyword);
				userItem.documentation = new vscode.MarkdownString('`user` — Represents the human input to the assistant.');

				const assistantItem = new vscode.CompletionItem('assistant', vscode.CompletionItemKind.Keyword);
				assistantItem.documentation = new vscode.MarkdownString('`assistant` — Represents the AI response.');

				return [systemItem, userItem, assistantItem];
			}
		},
		'"' // Trigger completion inside strings
	);
}
