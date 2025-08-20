import * as vscode from 'vscode';
import { getInspection } from '../services/gptpService.js';

export function registerCompletions(): vscode.Disposable {
	return vscode.languages.registerCompletionItemProvider(
		'gptp',
		{
			async provideCompletionItems(
				doc: vscode.TextDocument,
				pos: vscode.Position
			): Promise<vscode.CompletionItem[]> {
				const systemItem = new vscode.CompletionItem('system', vscode.CompletionItemKind.Keyword);
				systemItem.documentation = new vscode.MarkdownString('`system` — Sets the behavior, tone, or constraints of the assistant.');

				const userItem = new vscode.CompletionItem('user', vscode.CompletionItemKind.Keyword);
				userItem.documentation = new vscode.MarkdownString('`user` — Represents the human input to the assistant.');

				const assistantItem = new vscode.CompletionItem('assistant', vscode.CompletionItemKind.Keyword);
				assistantItem.documentation = new vscode.MarkdownString('`assistant` — Represents the AI response.');

				const items: vscode.CompletionItem[] = [systemItem, userItem, assistantItem];

				// If inside a string, suggest {{variable}} from declared variables
				const token = doc.getWordRangeAtPosition(pos, /"[^"]*"/);
				if (token) {
					const inspect = await getInspection(doc.getText());
					const vars: string[] = inspect?.variables?.map((v: any) => v.name || v) || [];
					for (const v of vars) {
						const ci = new vscode.CompletionItem(`{{${v}}}`, vscode.CompletionItemKind.Variable);
						ci.insertText = `{{${v}}}`;
						ci.detail = 'GPTP variable placeholder';
						items.push(ci);
					}
				}

				return items;
			}
		},
		'"' // Trigger completion inside strings
	);
}
