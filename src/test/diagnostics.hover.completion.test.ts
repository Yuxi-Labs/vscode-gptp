import * as assert from 'assert';
import * as vscode from 'vscode';

suite('GPTP diagnostics/hover/completion', () => {
  test('diagnostics map Ajv pointer to range (variables.name required)', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'gptp',
      content: `{
  "$doctype": "gptp",
  "schemaVersion": "1.2.0",
  "promptVersion": "1.0.0",
  "messages": [
    { "role": "user", "content": "hi" }
  ],
  "variables": [ { "description": "missing name" } ]
}
`,
    });
    const editor = await vscode.window.showTextDocument(doc);
    // Allow diagnostics debounce to run
    await new Promise(r => setTimeout(r, 600));
    const diags = vscode.languages.getDiagnostics(doc.uri);
    assert.ok(diags.length >= 1, 'Expected at least one diagnostic');
    // Ensure diagnostic has a non-zero range
    assert.ok(!diags[0].range.isEmpty, 'Diagnostic should have a range');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('hover shows variable info for {{name}}', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'gptp',
      content: `{
  "$doctype": "gptp",
  "schemaVersion": "1.2.0",
  "promptVersion": "1.0.0",
  "variables": [ { "name": "name", "description": "Name", "required": true } ],
  "messages": [
    { "role": "user", "content": "Hello {{name}}" }
  ]
}
`,
    });
    const editor = await vscode.window.showTextDocument(doc);
    const idx = doc.getText().indexOf('{{name}}') + 2; // inside token
    const pos = doc.positionAt(idx);
    const hovers = (await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, pos)) as vscode.Hover[];
    assert.ok(hovers && hovers.length > 0, 'Expected a hover result');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('completion suggests {{name}} when declared', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'gptp',
      content: `{
  "$doctype": "gptp",
  "schemaVersion": "1.2.0",
  "promptVersion": "1.0.0",
  "variables": [ { "name": "name" } ],
  "messages": [
    { "role": "user", "content": "Hello \"\"" }
  ]
}
`,
    });
    const editor = await vscode.window.showTextDocument(doc);
    const quoteOffset = doc.getText().indexOf('""');
    const pos = doc.positionAt(quoteOffset + 1);
    const completions = (await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, pos)) as vscode.CompletionList;
    const labels = (completions.items || []).map(i => i.label);
    assert.ok(labels.some(l => typeof l === 'string' && l.includes('{{name}}')), 'Expected completion for {{name}}');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
});
