import * as vscode from 'vscode';

export function activateDiagnostics(context: vscode.ExtensionContext) {
	const diagnosticCollection = vscode.languages.createDiagnosticCollection('gptp');
	context.subscriptions.push(diagnosticCollection);

	vscode.workspace.onDidOpenTextDocument(doc => {
		if (doc.languageId === 'gptp') {
			validateDocument(doc, diagnosticCollection);
		}
	});

	vscode.workspace.onDidChangeTextDocument(e => {
		if (e.document.languageId === 'gptp') {
			validateDocument(e.document, diagnosticCollection);
		}
	});

	vscode.workspace.onDidCloseTextDocument(doc => {
		diagnosticCollection.delete(doc.uri);
	});
}

function validateDocument(
	doc: vscode.TextDocument,
	collection: vscode.DiagnosticCollection
) {
	const diagnostics: vscode.Diagnostic[] = [];

	try {
		const text = doc.getText();
		const json = JSON.parse(text);

		// Rule: model is required
		if (!json.model) {
			const line = findLine(doc, '"model"');
			diagnostics.push(createDiagnostic(doc, line, `"model" is required.`));
		}

		// Rule: messages must contain at least one 'system' or top-level 'system', and one 'user'
		if (Array.isArray(json.messages)) {
			const roles = json.messages.map((m: any) => m.role);
			
			const hasSystem = roles.includes('system') || !!json.system;
			const hasUser = roles.includes('user');

			if (!hasSystem) {
				const line = findLine(doc, '"messages"');
				diagnostics.push(createDiagnostic(doc, line, `Missing system instructions. Add a "system" message or a top-level "system" field.`));
			}

			if (!hasUser) {
				const line = findLine(doc, '"messages"');
				diagnostics.push(createDiagnostic(doc, line, `No "user" message found.`));
			}
		}
	} catch (e) {
		// Ignore parse errors — those are already caught by JSON language features
	}

	collection.set(doc.uri, diagnostics);
}

function createDiagnostic(doc: vscode.TextDocument, line: number, msg: string): vscode.Diagnostic {
	const range = new vscode.Range(line, 0, line, 1000);
	return new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
}

function findLine(doc: vscode.TextDocument, search: string): number {
	const lines = doc.getText().split('\n');
	const line = lines.findIndex(l => l.includes(search));
	return line >= 0 ? line : 0;
}
