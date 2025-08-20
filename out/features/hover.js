import * as vscode from 'vscode';
import { getInspection } from '../services/gptpService.js';
const HOVER_HELP = {
    "$doctype": "`$doctype` — Format identifier; must be `gptp`.",
    "schemaVersion": "`schemaVersion` — The GPTP schema version (e.g., `1.2.0`).",
    "promptVersion": "`promptVersion` — Your prompt content version (semantic).",
    "title": "`title` — Human-readable name of this prompt.",
    "description": "`description` — Summary of what this prompt does.",
    "messages": "`messages` — Array of { role, content } turns forming the conversation.",
    "role": "`role` — One of `system`, `user`, or `assistant`.",
    "content": "`content` — Text content of a message (supports {{variable}} templates).",
    "system": "`system` — Optional global instruction to the assistant.",
    "variables": "`variables` — Input parameters referenced via {{var}} in content.",
    "required": "`required` — Whether a variable must be provided at runtime.",
    "example": "`example` — Example value for a variable.",
    "output_format": "`output_format` — Expected output format (`markdown`, `json`, `html`, `plain-text`).",
    "output_schema": "`output_schema` — JSON Schema for validating output structure.",
    "extends": "`extends` — Relative path to a base .gptp file.",
    "tools": "`tools` — Optional tool/function declarations for tool-augmented prompts.",
    "assets": "`assets` — Attachments (path + MIME type).",
    "vision": "`vision` — Expected image inputs.",
    "tests": "`tests` — Self-checks for prompt output.",
    "license": "`license` — SPDX license identifier (e.g., MIT).",
};
export function registerHoverProvider() {
    return vscode.languages.registerHoverProvider('gptp', {
        async provideHover(document, position) {
            // Key hovers
            const keyRange = document.getWordRangeAtPosition(position, /"[^"]+"/);
            if (keyRange) {
                const key = document.getText(keyRange).replace(/"/g, '');
                const doc = HOVER_HELP[key];
                if (doc) {
                    return new vscode.Hover(new vscode.MarkdownString(doc));
                }
            }
            // Variable placeholder hovers inside strings
            const varRange = document.getWordRangeAtPosition(position, /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/);
            if (varRange) {
                const placeholder = document.getText(varRange);
                const name = placeholder.replace(/[{}]/g, '');
                const inspect = await getInspection(document.getText());
                const found = (inspect?.variables || []).find((v) => (v.name || v) === name);
                if (found) {
                    const md = new vscode.MarkdownString();
                    md.appendMarkdown(`Variable: \`${name}\`\n\n`);
                    if (found.description) {
                        md.appendMarkdown(`${found.description}\n\n`);
                    }
                    if (typeof found.required === 'boolean') {
                        md.appendMarkdown(`Required: **${found.required ? 'yes' : 'no'}**\n\n`);
                    }
                    if (found.example) {
                        md.appendMarkdown(`Example: \`${found.example}\``);
                    }
                    md.isTrusted = true;
                    return new vscode.Hover(md);
                }
            }
        }
    });
}
//# sourceMappingURL=hover.js.map