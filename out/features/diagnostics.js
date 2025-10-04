import * as vscode from 'vscode';
import { validateText, getInspection } from '../services/gptpService.js';
export function activateDiagnostics(context) {
    const collection = vscode.languages.createDiagnosticCollection('gptp');
    context.subscriptions.push(collection);
    let timer;
    const scheduleValidate = (doc) => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => runValidate(doc), 300);
    };
    const runValidate = async (doc) => {
        if (doc.languageId !== 'gptp') {
            return;
        }
        const diagnostics = [];
        // Schema validation via SDK (Ajv under the hood)
        const text = doc.getText();
        const res = await validateText(text);
        for (const issue of res.issues) {
            let range;
            if (typeof issue.offset === 'number' && typeof issue.length === 'number' && issue.length > 0) {
                const start = doc.positionAt(issue.offset);
                const end = doc.positionAt(issue.offset + issue.length);
                range = new vscode.Range(start, end);
            }
            else {
                // Fallback: try a naive line scan using the last JSON Pointer segment
                const approx = issue.jsonPointer ? approximateRangeFromPointer(text, issue.jsonPointer) : undefined;
                if (approx) {
                    const start = doc.positionAt(approx.start);
                    const end = doc.positionAt(approx.end);
                    range = new vscode.Range(start, end);
                }
                else {
                    range = new vscode.Range(0, 0, 0, 1);
                }
            }
            const d = new vscode.Diagnostic(range, issue.message, vscode.DiagnosticSeverity.Error);
            diagnostics.push(d);
        }
        // Semantic checks: variables usage
        try {
            // reuse text from above
            const inspect = await getInspection(text);
            const declared = new Set((inspect?.variables || []).map((v) => v.name || v));
            const used = new Set();
            const varRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
            let m;
            while ((m = varRegex.exec(text))) {
                used.add(m[1]);
            }
            // Missing variable diagnostics: highlight first occurrence of {{var}}
            for (const v of used) {
                if (!declared.has(v)) {
                    const occ = findFirstVarUsageRange(text, v);
                    const range = occ
                        ? new vscode.Range(doc.positionAt(occ.start), doc.positionAt(occ.end))
                        : new vscode.Range(0, 0, 0, 1);
                    const d = new vscode.Diagnostic(range, `Variable "${v}" is used but not declared in variables.`, vscode.DiagnosticSeverity.Warning);
                    d.code = `gptp.missingVariable:${v}`;
                    diagnostics.push(d);
                }
            }
            // Unused variable diagnostics: highlight its declaration "name": "var"
            for (const v of declared) {
                if (!used.has(v)) {
                    const decl = findVarDeclarationRange(text, v);
                    const range = decl
                        ? new vscode.Range(doc.positionAt(decl.start), doc.positionAt(decl.end))
                        : new vscode.Range(0, 0, 0, 1);
                    const d = new vscode.Diagnostic(range, `Variable "${v}" is declared but not used.`, vscode.DiagnosticSeverity.Warning);
                    d.code = `gptp.unusedVariable:${v}`;
                    diagnostics.push(d);
                }
            }
        }
        catch {
            // ignore JSON parse errors; JSON LS will report them
        }
        collection.set(doc.uri, diagnostics);
    };
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((doc) => scheduleValidate(doc)));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => scheduleValidate(e.document)));
    // Also revalidate on save to ensure stale diagnostics are cleared automatically
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => scheduleValidate(doc)));
    // Revalidate when files change on disk (e.g., external edits or SCM checkout)
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.gptp');
    context.subscriptions.push(watcher, watcher.onDidChange((uri) => {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        if (doc) {
            scheduleValidate(doc);
        }
    }), watcher.onDidCreate((uri) => {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        if (doc) {
            scheduleValidate(doc);
        }
    }), watcher.onDidDelete((uri) => collection.delete(uri)));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)));
    // Kick off an initial validation for all currently open GPTP docs
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === 'gptp' && doc.uri.scheme !== 'git') {
            scheduleValidate(doc);
        }
    }
}
function approximateRangeFromPointer(text, pointer) {
    try {
        if (!pointer || pointer === '/') {
            return undefined;
        }
        const parts = pointer.split('/').slice(1).map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
        const last = parts[parts.length - 1];
        if (!last) {
            return undefined;
        }
        // Try to find the property key and its value
        // This is a best-effort regex; it may fail for complex formatting
        const keyPattern = new RegExp(`"${escapeRegExp(last)}"\s*:\s*`, 'g');
        const m = keyPattern.exec(text);
        if (!m) {
            return undefined;
        }
        const valueStart = m.index + m[0].length;
        // Heuristic: if value starts with quote, capture string; if { or [, capture balanced block; else capture until comma or end brace
        const ch = text[valueStart];
        if (ch === '"') {
            // string: consume until next unescaped quote
            let i = valueStart + 1;
            for (; i < text.length; i++) {
                if (text[i] === '"' && text[i - 1] !== '\\') {
                    break;
                }
            }
            return { start: valueStart, end: i + 1 };
        }
        else if (ch === '{' || ch === '[') {
            const end = findBalancedEnd(text, valueStart);
            if (end > valueStart) {
                return { start: valueStart, end };
            }
        }
        // primitive: read until comma or closing brace/bracket
        let i = valueStart;
        for (; i < text.length; i++) {
            const c = text[i];
            if (c === ',' || c === '\n' || c === '}' || c === ']') {
                break;
            }
        }
        return { start: valueStart, end: i };
    }
    catch {
        return undefined;
    }
}
function findBalancedEnd(text, start) {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            // skip strings
            i++;
            while (i < text.length) {
                if (text[i] === '"' && text[i - 1] !== '\\') {
                    break;
                }
                i++;
            }
            continue;
        }
        if (c === open) {
            depth++;
        }
        else if (c === close) {
            depth--;
            if (depth === 0) {
                return i + 1;
            }
        }
    }
    return -1;
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Find the first occurrence of {{varName}} in the text and return its range
function findFirstVarUsageRange(text, varName) {
    try {
        const re = new RegExp(`\\{\\{${escapeRegExp(varName)}\\}\\}`);
        const m = re.exec(text);
        if (!m) {
            return undefined;
        }
        return { start: m.index, end: m.index + m[0].length };
    }
    catch {
        return undefined;
    }
}
// Try to locate the variable declaration inside the variables array
function findVarDeclarationRange(text, varName) {
    try {
        // Locate the variables array block first
        const varsKey = /"variables"\s*:\s*\[/g;
        const m = varsKey.exec(text);
        if (!m) {
            return undefined;
        }
        const arrStart = m.index + m[0].length - 1; // position at '['
        const arrEnd = findBalancedEnd(text, arrStart);
        if (arrEnd <= arrStart) {
            return undefined;
        }
        const segment = text.slice(arrStart, arrEnd);
        const nameRe = new RegExp(`"name"\s*:\s*"${escapeRegExp(varName)}"`, 'g');
        const m2 = nameRe.exec(segment);
        if (!m2) {
            return undefined;
        }
        const start = arrStart + m2.index + m2[0].indexOf('"' + varName + '"');
        const end = start + (`"${varName}"`).length;
        return { start, end };
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=diagnostics.js.map