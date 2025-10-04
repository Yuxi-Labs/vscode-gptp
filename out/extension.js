import * as vscode from 'vscode';
import { registerCompletions } from './features/completion.js';
import { activateDiagnostics } from './features/diagnostics.js';
import { registerHoverProvider } from './features/hover.js';
import { registerSnippets } from './features/snippets.js';
import { registerCodeActions } from './features/codeActions.js';
import { validateText, executePreview as sdkExecutePreview, migrateTo120Text, diffPromptKeysText, getInspectionSummary, executeRun, formatOutput } from './services/gptpService.js';
// Remember last inputs per document for quick reuse
const lastInputsByDoc = new Map();
export function activate(context) {
    const log = vscode.window.createOutputChannel('GPTP');
    context.subscriptions.push(log);
    log.appendLine(`[GPTP] Activated. VS Code ${vscode.version}, Node ${process.versions.node}`);
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
    // Watch for pasted GPTP content (opt-in via setting)
    vscode.workspace.onDidChangeTextDocument((event) => {
        const cfg = vscode.workspace.getConfiguration('gptp');
        if (!cfg.get('autoDetectPasted', false)) {
            return;
        }
        const { document } = event;
        if (document.languageId === 'gptp') {
            return;
        }
        if (!shouldInspectForGptp(document)) {
            return;
        }
        const text = document.getText();
        if (!looksLikeGptp(text)) {
            return;
        }
        console.log(`[GPTP] Switching language for pasted content: ${document.uri.fsPath}`);
        vscode.languages.setTextDocumentLanguage(document, 'gptp');
    });
    // Detect GPTP content on open (opt-in via setting)
    vscode.workspace.onDidOpenTextDocument((document) => {
        const cfg = vscode.workspace.getConfiguration('gptp');
        if (!cfg.get('autoDetectPasted', false)) {
            return;
        }
        if (document.languageId === 'gptp') {
            return;
        }
        if (!shouldInspectForGptp(document)) {
            return;
        }
        const text = document.getText();
        if (!looksLikeGptp(text)) {
            return;
        }
        console.log(`[GPTP] Switching language on open: ${document.uri.fsPath}`);
        vscode.languages.setTextDocumentLanguage(document, 'gptp');
    });
    // "New GPT Prompt File" command
    context.subscriptions.push(vscode.commands.registerCommand('gptp.newPrompt', async () => {
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
    }));
    // Validate command
    context.subscriptions.push(vscode.commands.registerCommand('gptp.validate', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const res = await validateText(editor.document.getText());
        if (res.valid) {
            vscode.window.showInformationMessage('GPTP: Document is valid.');
        }
        else {
            vscode.window.showWarningMessage(`GPTP: Found ${res.issues.length} validation issue(s). See Problems panel.`);
        }
    }));
    // Execute preview command
    context.subscriptions.push(vscode.commands.registerCommand('gptp.executePreview', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        try {
            const { resolvedMessages, modelOutput } = await sdkExecutePreview(editor.document.getText(), {});
            const content = `Resolved Messages\n\n${JSON.stringify(resolvedMessages, null, 2)}\n\nModel Output (mock)\n\n${JSON.stringify(modelOutput, null, 2)}`;
            const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '```json\n' + content + '\n```' });
            await vscode.window.showTextDocument(doc, { preview: true });
        }
        catch (e) {
            vscode.window.showErrorMessage(`GPTP: Execute preview failed: ${e?.message || e}`);
        }
    }));
    // Execute with model (run:true)
    context.subscriptions.push(vscode.commands.registerCommand('gptp.executeRun', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const text = editor.document.getText();
        // Prompt for missing variables based on inspection (required only)
        const summary = await getInspectionSummary(text);
        const docKey = editor.document.uri.toString();
        const required = summary?.required || [];
        let inputs = {};
        const last = lastInputsByDoc.get(docKey);
        if (last && Object.keys(last).length > 0) {
            const pick = await vscode.window.showQuickPick([
                { label: 'Run again with last inputs', description: 'Reuse inputs from last run' },
                { label: 'Enter inputs…', description: 'Prompt for required variables' },
            ], { placeHolder: 'Choose how to provide variable inputs' });
            if (!pick) {
                return;
            }
            if (pick.label.startsWith('Run again')) {
                // Start with last inputs, but ensure required are present
                inputs = { ...last };
                for (const name of required) {
                    const current = inputs[name];
                    if (current === undefined || current === null || current === '') {
                        const val = await vscode.window.showInputBox({ prompt: `Value for required variable: ${name}`, ignoreFocusOut: true });
                        if (val !== undefined && val !== null) {
                            inputs[name] = val;
                        }
                    }
                }
            }
            else {
                // Fresh prompts
                inputs = {};
                for (const name of required) {
                    const val = await vscode.window.showInputBox({ prompt: `Value for required variable: ${name}`, ignoreFocusOut: true });
                    if (val !== undefined && val !== null) {
                        inputs[name] = val;
                    }
                }
            }
        }
        else {
            // No prior inputs; prompt fresh
            inputs = {};
            for (const name of required) {
                const val = await vscode.window.showInputBox({ prompt: `Value for required variable: ${name}`, ignoreFocusOut: true });
                if (val !== undefined && val !== null) {
                    inputs[name] = val;
                }
            }
        }
        // Read configuration for run options
        const cfg = vscode.workspace.getConfiguration('gptp');
        const validate = cfg.get('run.validate', true);
        const timeoutMs = cfg.get('run.timeoutMs', 60000);
        const retries = cfg.get('run.retry.retries', 2);
        const baseDelayMs = cfg.get('run.retry.baseDelayMs', 250);
        const maxDelayMs = cfg.get('run.retry.maxDelayMs', 2000);
        const jitter = cfg.get('run.retry.jitter', true);
        const lockfilePath = cfg.get('run.lockfilePath', '');
        const httpEnable = cfg.get('http.enableFallback', false);
        const httpBase = cfg.get('http.baseUrl', '');
        const httpModel = cfg.get('http.model', '');
        const httpTemp = cfg.get('http.temperature', 0.7);
        const httpKey = cfg.get('http.apiKey', '');
        try {
            const res = await executeRun(text, inputs, {
                validate,
                timeoutMs,
                retry: { retries, baseDelayMs, maxDelayMs, jitter },
                lockfilePath: lockfilePath || undefined,
                httpFallback: httpEnable && httpBase && httpModel ? { baseUrl: httpBase, model: httpModel, temperature: httpTemp, apiKey: httpKey || undefined } : undefined,
            });
            if (res.usedFallback) {
                vscode.window.setStatusBarMessage('GPTP: Used HTTP fallback', 4000);
            }
            // Save inputs for next time
            lastInputsByDoc.set(docKey, { ...inputs });
            // Try to format using prompt-declared output format when possible
            let formatted = '';
            try {
                formatted = await formatOutput(res.modelOutput, {});
            }
            catch {
                formatted = String(res.modelOutput ?? '');
            }
            const content = `--- resolvedMessages ---\n\n${JSON.stringify(res.resolvedMessages, null, 2)}\n\n--- modelOutput (formatted) ---\n\n${formatted}`;
            const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '```markdown\n' + content + '\n```' });
            await vscode.window.showTextDocument(doc, { preview: true });
        }
        catch (e) {
            // Log details for debugging SDK ESM/provider issues
            log.appendLine('[GPTP] Execute run error: ' + (e?.stack || e?.message || String(e)));
            const msg = e?.message || String(e);
            // If SDK ESM/provider import failed, offer to configure HTTP fallback to a real provider and retry
            if (/Cannot use import statement outside a module/i.test(msg) || /executePrompt not available/i.test(msg)) {
                log.appendLine('[GPTP] Detected ESM/provider import failure in SDK path.');
                const choice = await vscode.window.showErrorMessage('GPTP: SDK execution failed. Configure HTTP fallback to a provider (e.g., OpenAI) and retry?', 'Configure & Retry', 'Open Settings', 'Dismiss');
                if (choice === 'Configure & Retry') {
                    const httpBase = await vscode.window.showInputBox({ prompt: 'HTTP base URL (e.g., https://api.openai.com/v1)', ignoreFocusOut: true });
                    if (!httpBase) {
                        return;
                    }
                    const httpModel = await vscode.window.showInputBox({ prompt: 'Model (e.g., gpt-4o-mini)', ignoreFocusOut: true });
                    if (!httpModel) {
                        return;
                    }
                    const httpKey = await vscode.window.showInputBox({ prompt: 'API Key (Bearer)', password: true, ignoreFocusOut: true });
                    const cfg = vscode.workspace.getConfiguration('gptp');
                    await cfg.update('http.enableFallback', true, vscode.ConfigurationTarget.Global);
                    await cfg.update('http.baseUrl', httpBase, vscode.ConfigurationTarget.Global);
                    await cfg.update('http.model', httpModel, vscode.ConfigurationTarget.Global);
                    if (httpKey) {
                        await cfg.update('http.apiKey', httpKey, vscode.ConfigurationTarget.Global);
                    }
                    // Retry once
                    vscode.window.setStatusBarMessage('GPTP: Retrying with HTTP fallback…', 4000);
                    try {
                        const res2 = await executeRun(text, inputs, {
                            validate,
                            timeoutMs,
                            retry: { retries, baseDelayMs, maxDelayMs, jitter },
                            lockfilePath: lockfilePath || undefined,
                            httpFallback: { baseUrl: httpBase, model: httpModel, temperature: httpTemp, apiKey: httpKey || undefined },
                        });
                        if (res2.usedFallback) {
                            vscode.window.setStatusBarMessage('GPTP: Used HTTP fallback', 4000);
                        }
                        lastInputsByDoc.set(docKey, { ...inputs });
                        let formatted = '';
                        try {
                            formatted = await formatOutput(res2.modelOutput, {});
                        }
                        catch {
                            formatted = String(res2.modelOutput ?? '');
                        }
                        const content = `--- resolvedMessages ---\n\n${JSON.stringify(res2.resolvedMessages, null, 2)}\n\n--- modelOutput (formatted) ---\n\n${formatted}`;
                        const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '```markdown\n' + content + '\n```' });
                        await vscode.window.showTextDocument(doc, { preview: true });
                        return;
                    }
                    catch (e2) {
                        vscode.window.showErrorMessage(`GPTP: Execute run failed (fallback): ${e2?.message || e2}`);
                        return;
                    }
                }
                else if (choice === 'Open Settings') {
                    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:yuxi-labs.vscode-gptp gptp.http');
                    return;
                }
            }
            vscode.window.showErrorMessage(`GPTP: Execute run failed: ${msg}`);
        }
    }));
    // Migrate command
    context.subscriptions.push(vscode.commands.registerCommand('gptp.migrate', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        try {
            const migratedText = await migrateTo120Text(editor.document.getText());
            const fullRange = new vscode.Range(0, 0, editor.document.lineCount, 0);
            await editor.edit((b) => b.replace(fullRange, migratedText));
            vscode.window.showInformationMessage('GPTP: Migrated to v1.2.0.');
        }
        catch (e) {
            vscode.window.showErrorMessage(`GPTP: Migration failed: ${e?.message || e}`);
        }
    }));
    // Diff command (nice-to-have): compare two open GPTP docs
    context.subscriptions.push(vscode.commands.registerCommand('gptp.diff', async () => {
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
    }));
}
function activateExistingDocuments() {
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId !== 'gptp' &&
            doc.uri.fsPath.endsWith('.gptp') &&
            looksLikeGptp(doc.getText())) {
            console.log(`[GPTP] Switching existing open doc to gptp: ${doc.uri.fsPath}`);
            vscode.languages.setTextDocumentLanguage(doc, 'gptp');
        }
    }
}
function looksLikeGptp(text) {
    try {
        const json = JSON.parse(text);
        return (typeof json === 'object' &&
            json.$doctype === 'gptp' &&
            typeof json.schemaVersion === 'string' &&
            Array.isArray(json.messages));
    }
    catch {
        return false;
    }
}
function shouldInspectForGptp(document) {
    try {
        // If it already has .gptp extension, allow
        if (document.uri.fsPath.endsWith('.gptp')) {
            return true;
        }
        // Only consider lightweight plaintext/JSON/untitled docs
        const lang = document.languageId;
        if (lang !== 'json' && lang !== 'plaintext' && lang !== 'untitled') {
            return false;
        }
        // Avoid parsing very large files
        const len = document.getText().length;
        if (len > 200_000) {
            return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
export function deactivate() { }
//# sourceMappingURL=extension.js.map