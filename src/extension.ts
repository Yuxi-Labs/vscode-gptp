import * as vscode from 'vscode';
import { registerCompletions } from './features/completion.js';
import { activateDiagnostics } from './features/diagnostics.js';
import { registerHoverProvider } from './features/hover.js';
import { registerSnippets } from './features/snippets.js';
import { registerCodeActions } from './features/codeActions.js';
import { validateText, executePreview as sdkExecutePreview, migrateTo120Text, diffPromptKeysText } from './services/gptpService.js';

export function activate(context: vscode.ExtensionContext) {
  console.log('GPTP extension activated.');

  context.subscriptions.push(registerCompletions());
  activateDiagnostics(context);
  context.subscriptions.push(registerHoverProvider());

  const snippetCommands = registerSnippets();
  context.subscriptions.push(...snippetCommands);
  const codeActionRegs = registerCodeActions();
  context.subscriptions.push(...codeActionRegs);

  // Handle any .gptp files already open
  activateExistingDocuments();

  // Watch for pasted GPTP content
  vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
    const { document } = event;

    if (document.languageId === 'gptp') {return;}
    if (!looksLikeGptp(document.getText())) {return;}

    console.log(`[GPTP] Switching language for pasted content: ${document.uri.fsPath}`);
    vscode.languages.setTextDocumentLanguage(document, 'gptp');
  });

  // Detect .gptp files or pasted content on open
  vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
    if (document.languageId === 'gptp') {return;}
    if (!looksLikeGptp(document.getText())) {return;}

    console.log(`[GPTP] Switching language on open: ${document.uri.fsPath}`);
    vscode.languages.setTextDocumentLanguage(document, 'gptp');
  });

  // "New GPT Prompt File" command
  context.subscriptions.push(
    vscode.commands.registerCommand('gptp.newPrompt', async () => {
      const doc = await vscode.workspace.openTextDocument({
        content: `{
  "$doctype": "gptp",
  "schemaVersion": "1.2.0",
  "promptVersion": "1.0.0",
  "title": "New Prompt",
  "description": "Describe what this prompt does.",
  "system": "You are a helpful assistant.",
  "variables": [
    { "name": "name", "description": "Name to greet", "required": true, "example": "World" }
  ],
  "messages": [
    { "role": "user", "content": "Say hello to {{name}}" }
  ],
  "output_format": "markdown"
}`,
        language: 'gptp'
      });
      await vscode.window.showTextDocument(doc);
    })
  );

  // Validate command
  context.subscriptions.push(
    vscode.commands.registerCommand('gptp.validate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const res = await validateText(editor.document.getText());
      if (res.valid) {
        vscode.window.showInformationMessage('GPTP: Document is valid.');
      } else {
        vscode.window.showWarningMessage(`GPTP: Found ${res.issues.length} validation issue(s). See Problems panel.`);
      }
    })
  );

  // Execute preview command
  context.subscriptions.push(
    vscode.commands.registerCommand('gptp.executePreview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      try {
        const { resolvedMessages, modelOutput } = await sdkExecutePreview(editor.document.getText(), {});
        const content = `Resolved Messages\n\n${JSON.stringify(resolvedMessages, null, 2)}\n\nModel Output (mock)\n\n${JSON.stringify(modelOutput, null, 2)}`;
        const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '```json\n' + content + '\n```' });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (e: any) {
        vscode.window.showErrorMessage(`GPTP: Execute preview failed: ${e?.message || e}`);
      }
    })
  );

  // Migrate command
  context.subscriptions.push(
    vscode.commands.registerCommand('gptp.migrate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      try {
        const migratedText = await migrateTo120Text(editor.document.getText());
        const fullRange = new vscode.Range(0, 0, editor.document.lineCount, 0);
  await editor.edit((b: vscode.TextEditorEdit) => b.replace(fullRange, migratedText));
        vscode.window.showInformationMessage('GPTP: Migrated to v1.2.0.');
      } catch (e: any) {
        vscode.window.showErrorMessage(`GPTP: Migration failed: ${e?.message || e}`);
      }
    })
  );

  // Diff command (nice-to-have): compare two open GPTP docs
  context.subscriptions.push(
    vscode.commands.registerCommand('gptp.diff', async () => {
      const editors = vscode.window.visibleTextEditors.filter(e => e.document.languageId === 'gptp');
      if (editors.length < 2) {
        vscode.window.showInformationMessage('Open two GPTP files to diff.');
        return;
      }
      const a = editors[0].document.getText();
      const b = editors[1].document.getText();
      const res = await diffPromptKeysText(a, b);
      const content = 'GPTP Diff (top-level keys)\n\n' + JSON.stringify(res, null, 2);
      const doc = await vscode.workspace.openTextDocument({ language: 'json', content });
      await vscode.window.showTextDocument(doc, { preview: true });
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
  json.$doctype === 'gptp' &&
  typeof json.schemaVersion === 'string' &&
  Array.isArray(json.messages)
    );
  } catch {
    return false;
  }
}

export function deactivate() {}
