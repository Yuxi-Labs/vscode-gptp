import * as vscode from 'vscode';
import { getInspectionSummary } from '../services/gptpService.js';
export function registerCodeActions() {
    const provider = {
        async provideCodeActions(doc, range, context) {
            const actions = [];
            for (const d of context.diagnostics) {
                if (typeof d.code === 'string') {
                    if (d.code.startsWith('gptp.missingVariable:')) {
                        const name = d.code.split(':')[1];
                        // Add variable action
                        actions.push(createAddVariableCommandAction(doc, name));
                        // Replace with declared variable action
                        actions.push(createReplaceVariableCommandAction(doc, d.range, name));
                    }
                    else if (d.code.startsWith('gptp.unusedVariable:')) {
                        const name = d.code.split(':')[1];
                        actions.push(createRemoveVariableCommandAction(doc, name));
                    }
                }
            }
            return actions;
        },
    };
    const providerReg = vscode.languages.registerCodeActionsProvider('gptp', provider, {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    });
    const replaceCmd = vscode.commands.registerCommand('gptp.replaceVariable', async (uri, targetRange, fromName) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const summary = await getInspectionSummary(doc.getText());
        const candidates = (summary?.variables || []).filter((v) => v !== fromName);
        if (!candidates.length) {
            vscode.window.showInformationMessage('No declared variables to replace with.');
            return;
        }
        const pick = await vscode.window.showQuickPick(candidates, { placeHolder: `Replace ${fromName} with…` });
        if (!pick) {
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        // Replace full token like {{fromName}} within range
        const docText = doc.getText(targetRange);
        const replaced = docText.replace(new RegExp(`\\{\\{${escapeRegExp(fromName)}\\}\\}`, 'g'), `{{${pick}}}`);
        edit.replace(uri, targetRange, replaced);
        await vscode.workspace.applyEdit(edit);
    });
    const addCmd = vscode.commands.registerCommand('gptp.addVariable', async (uri, name) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const original = doc.getText();
        const next = await computeAddVariableText(original, name);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), next);
        await vscode.workspace.applyEdit(edit);
    });
    const removeCmd = vscode.commands.registerCommand('gptp.removeVariable', async (uri, name) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const original = doc.getText();
        const next = await computeRemoveVariableText(original, name);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), next);
        await vscode.workspace.applyEdit(edit);
    });
    return [providerReg, replaceCmd, addCmd, removeCmd];
}
function createAddVariableCommandAction(doc, name) {
    const action = new vscode.CodeAction(`Add variable \"${name}\" to variables`, vscode.CodeActionKind.QuickFix);
    action.command = {
        command: 'gptp.addVariable',
        title: 'Add variable',
        arguments: [doc.uri, name],
    };
    return action;
}
function createRemoveVariableCommandAction(doc, name) {
    const action = new vscode.CodeAction(`Remove unused variable \"${name}\"`, vscode.CodeActionKind.QuickFix);
    action.command = {
        command: 'gptp.removeVariable',
        title: 'Remove variable',
        arguments: [doc.uri, name],
    };
    return action;
}
function createReplaceVariableCommandAction(doc, range, fromName) {
    const action = new vscode.CodeAction(`Replace with declared variable…`, vscode.CodeActionKind.QuickFix);
    action.command = {
        command: 'gptp.replaceVariable',
        title: 'Replace with declared variable…',
        arguments: [doc.uri, range, fromName],
    };
    return action;
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
async function computeAddVariableText(text, name) {
    const formattingOptions = { insertSpaces: true, tabSize: 2, eol: '\n' };
    try {
        const mod = await import('jsonc-parser');
        const parseTree = mod.parseTree;
        const findNodeAtLocation = mod.findNodeAtLocation;
        const modify = mod.modify;
        const applyEdits = mod.applyEdits;
        const tree = parseTree(text);
        const variablesNode = tree ? findNodeAtLocation(tree, ['variables']) : undefined;
        let edits = [];
        const newItem = { name, description: '', required: false };
        if (!variablesNode) {
            edits = modify(text, ['variables'], [newItem], { formattingOptions });
        }
        else {
            const idx = Array.isArray(variablesNode.children) ? variablesNode.children.length : 0;
            edits = modify(text, ['variables', idx], newItem, { formattingOptions });
        }
        return applyEdits(text, edits);
    }
    catch {
        const insert = `\n  "variables": [ { "name": "${name}", "description": "", "required": false } ],\n`;
        const pos = text.indexOf('\n  "messages"');
        if (pos !== -1) {
            return text.slice(0, pos) + insert + text.slice(pos);
        }
        const beforeEnd = text.lastIndexOf('}\n');
        const at = beforeEnd !== -1 ? beforeEnd : text.length - 1;
        return text.slice(0, at) + ',\n' + insert.trim() + '\n}';
    }
}
async function computeRemoveVariableText(text, name) {
    const formattingOptions = { insertSpaces: true, tabSize: 2, eol: '\n' };
    try {
        const mod = await import('jsonc-parser');
        const parseTree = mod.parseTree;
        const findNodeAtLocation = mod.findNodeAtLocation;
        const modify = mod.modify;
        const applyEdits = mod.applyEdits;
        const tree = parseTree(text);
        const varsNode = tree ? findNodeAtLocation(tree, ['variables']) : undefined;
        if (!varsNode || !Array.isArray(varsNode.children)) {
            return text;
        }
        let index = -1;
        for (let i = 0; i < varsNode.children.length; i++) {
            const nameNode = findNodeAtLocation(varsNode, [i, 'name']);
            if (!nameNode) {
                continue;
            }
            const val = JSON.parse(text.substring(nameNode.offset, nameNode.offset + nameNode.length));
            if (val === name) {
                index = i;
                break;
            }
        }
        if (index < 0) {
            return text;
        }
        const edits = modify(text, ['variables', index], undefined, { formattingOptions });
        return applyEdits(text, edits);
    }
    catch {
        const pattern = new RegExp(`\\{\\s*"name"\\s*:\\s*"${escapeRegExp(name)}"[\\s\\S]*?\\}`, 'm');
        return text.replace(pattern, '').replace(/,\s*,/g, ',').replace(/\[\s*,/g, '[').replace(/,\s*\]/g, ']');
    }
}
//# sourceMappingURL=codeActions.js.map