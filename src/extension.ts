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

  // Handle any .gptp files already open
  activateExistingDocuments();

  // Watch for pasted GPTP content
  vscode.workspace.onDidChangeTextDocument(event => {
    const { document } = event;

    if (document.languageId === 'gptp') return;
    if (!looksLikeGptp(document.getText())) return;

    console.log(`[GPTP] Switching language for pasted content: ${document.uri.fsPath}`);
    vscode.languages.setTextDocumentLanguage(document, 'gptp');
  });

  // Detect .gptp files or pasted content on open
  vscode.workspace.onDidOpenTextDocument(document => {
    if (document.languageId === 'gptp') return;
    if (!looksLikeGptp(document.getText())) return;

    console.log(`[GPTP] Switching language on open: ${document.uri.fsPath}`);
    vscode.languages.setTextDocumentLanguage(document, 'gptp');
  });

  // "New GPT Prompt File" command
  context.subscriptions.push(
    vscode.commands.registerCommand('gptp.newPrompt', async () => {
      const doc = await vscode.workspace.openTextDocument({
        content: `{
  "$schema": "https://raw.githubusercontent.com/Yuxi-Labs/gptp/v1.0.0/schema/gptp.schema.json",
  "name": "",
  "description": "",
  "version": "1.0",
  "system": "",
  "messages": [],
  "variables": []
}`,
        language: 'gptp'
      });
      await vscode.window.showTextDocument(doc);
    })
  );
}

function activateExistingDocuments() {
  for (const doc of vscode.workspace.textDocuments) {
    if (
      doc.languageId !== 'gptp' &&
      doc.uri.fsPath.endsWith('.gptp') &&
      looksLikeGptp(doc.getText())
    ) {
      console.log(`[GPTP] Switching existing open doc to gptp: ${doc.uri.fsPath}`);
      vscode.languages.setTextDocumentLanguage(doc, 'gptp');
    }
  }
}

function looksLikeGptp(text: string): boolean {
  try {
    const json = JSON.parse(text);
    return (
      typeof json === 'object' &&
      typeof json.name === 'string' &&
      typeof json.messages === 'object' &&
      '$schema' in json &&
      json.$schema.includes('gptp.schema.json')
    );
  } catch {
    return false;
  }
}

export function deactivate() {}
