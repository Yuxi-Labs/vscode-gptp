import * as vscode from 'vscode';
import { registerCompletions } from './features/completion';
import { activateDiagnostics } from './features/diagnostics';
import { registerHoverProvider } from './features/hover';
import { registerSnippets } from './features/snippets';

export function activate(context: vscode.ExtensionContext) {
  console.log('GPTP extension activated.');

  context.subscriptions.push(registerCompletions());
  activateDiagnostics(context);
  context.subscriptions.push(registerHoverProvider());

  const snippetCommands = registerSnippets();
	context.subscriptions.push(...snippetCommands);
}

export function deactivate() {}
