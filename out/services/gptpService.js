// Use dynamic import to interop with ESM SDK; indirection avoids bundlers trying to include it
async function core() {
    const segA = '@yuxilabs';
    const segB = '/gptp-core';
    const pkg = segA + segB;
    // Use eval-based import to avoid bundler resolution
    const din = (0, eval)('import');
    return await din(pkg);
}
// Avoid long stalls on SDK import/usage by racing with a timeout and falling back to local logic
async function importCoreSafely(timeoutMs = 250) {
    try {
        const timer = new Promise((resolve) => setTimeout(() => resolve(undefined), timeoutMs));
        // Race the real import with a short timeout; if it loses the race, return undefined and use fallbacks
        return await Promise.race([core(), timer]);
    }
    catch {
        return undefined;
    }
}
export async function validateText(textOrObj) {
    try {
        const isString = typeof textOrObj === 'string';
        const text = isString ? textOrObj : JSON.stringify(textOrObj);
        const obj = isString ? JSON.parse(text) : textOrObj;
        // Editing-time validation uses a fast local validator to stay responsive
        const quick = await quickValidate(obj, text);
        return quick;
    }
    catch (err) {
        // Final fallback: try local schema validation if JSON parsed successfully
        try {
            const isString = typeof textOrObj === 'string';
            const text = isString ? textOrObj : JSON.stringify(textOrObj);
            const obj = isString ? JSON.parse(text) : textOrObj;
            return await quickValidate(obj, text);
        }
        catch { }
        return { valid: false, issues: [{ message: 'Invalid JSON' }] };
    }
}
async function quickValidate(obj, text) {
    const issues = [];
    // Ensure basic shape
    if (!obj || typeof obj !== 'object') {
        return { valid: false, issues: [{ message: 'Document must be a JSON object' }] };
    }
    if (obj.$doctype !== 'gptp') {
        issues.push({ message: 'Missing or invalid $doctype (must be "gptp")', ...await pointerOrObjectRange(text, []) });
    }
    if (!Array.isArray(obj.messages)) {
        issues.push({ message: 'messages must be an array', jsonPointer: '/messages', ...await pointerOrObjectRange(text, ['messages']) });
    }
    // variables[]: each item must have a string name
    if (Array.isArray(obj.variables)) {
        for (let i = 0; i < obj.variables.length; i++) {
            const item = obj.variables[i];
            if (!item || typeof item !== 'object' || typeof item.name !== 'string' || item.name.trim() === '') {
                const jsonPointer = `/variables/${i}/name`;
                const loc = await objectItemRange(text, ['variables', i]);
                issues.push({ message: "variables[i] must have required property 'name'", jsonPointer, ...loc });
            }
        }
    }
    return { valid: issues.length === 0, issues };
}
async function objectItemRange(text, path) {
    try {
        const mod = await import('jsonc-parser');
        const parseTree = mod.parseTree;
        const findNodeAtLocation = mod.findNodeAtLocation;
        const tree = parseTree(text);
        const node = tree ? findNodeAtLocation(tree, path) : undefined;
        if (node) {
            return { offset: node.offset, length: node.length };
        }
        return {};
    }
    catch {
        return {};
    }
}
async function pointerOrObjectRange(text, path) {
    const pointer = '/' + path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
    const byPointer = await jsonPointerToOffset(text, pointer);
    if (byPointer.offset !== undefined) {
        return byPointer;
    }
    return objectItemRange(text, path);
}
export async function getInspection(text) {
    try {
        const obj = JSON.parse(text);
        // Editing-time inspection uses local logic only to avoid heavy imports
        return localInspect(obj);
    }
    catch {
        return undefined;
    }
}
export async function getInspectionSummary(text) {
    const info = await getInspection(text);
    if (!info) {
        return undefined;
    }
    const variables = (info.variables || []).map((v) => v.name || String(v));
    const required = (info.variables || []).filter((v) => !!v.required).map((v) => v.name || String(v));
    const roles = (info.messages || info.resolvedMessages || []).map((m) => m.role).filter(Boolean);
    return { variables, required, roles };
}
export async function executePreview(text, input) {
    const obj = JSON.parse(text);
    // Local preview: naive variable interpolation only (no provider calls)
    const vars = buildVariableMap(obj);
    const resolved = Array.isArray(obj.messages) ? obj.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? interpolate(m.content, { ...vars, ...(input || {}) }) : m.content
    })) : [];
    return { resolvedMessages: resolved, modelOutput: undefined };
}
export function formatOutput(raw, opts) {
    // formatPrompt is pure and synchronous per SDK surface
    // but still load via dynamic import to avoid static ESM import
    return importCoreSafely().then((sdk) => {
        const fn = sdk?.formatPrompt || sdk?.default?.formatPrompt || sdk?.formatOutput || sdk?.default?.formatOutput;
        return fn ? fn(raw, opts || {}) : String(raw?.content ?? '');
    });
}
// Execute with provider calls enabled (run:true). Throws if SDK not available.
export async function executeRun(text, input, options) {
    const obj = JSON.parse(text);
    try {
        const sdk = await importCoreSafely();
        const fn = sdk?.executePrompt || sdk?.default?.executePrompt;
        if (!fn) {
            throw new Error('missing executePrompt');
        }
        const res = await fn(obj, {
            input: input || {},
            run: true,
            validate: options?.validate ?? true,
            timeoutMs: options?.timeoutMs,
            retry: options?.retry,
            lockfilePath: options?.lockfilePath,
        });
        return { ...res, usedFallback: false };
    }
    catch (err) {
        // HTTP fallback to OpenAI-compatible API if configured
        const fb = options?.httpFallback;
        if (!fb || !fb.baseUrl || !fb.model) {
            throw err;
        }
        // Build resolved messages locally (simple interpolation fallback)
        const vars = buildVariableMap(obj);
        const resolved = Array.isArray(obj.messages) ? obj.messages.map((m) => ({
            role: m.role,
            content: typeof m.content === 'string' ? interpolate(m.content, { ...vars, ...(input || {}) }) : m.content
        })) : [];
        const base = fb.baseUrl.replace(/\/$/, '');
        const url = base + '/chat/completions';
        const body = {
            model: fb.model,
            messages: resolved.map((m) => ({ role: m.role, content: m.content })),
            temperature: typeof fb.temperature === 'number' ? fb.temperature : 0.7,
        };
        const headers = {
            'content-type': 'application/json',
        };
        if (fb.apiKey) {
            headers['authorization'] = `Bearer ${fb.apiKey}`;
        }
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`HTTP fallback failed: ${res.status} ${res.statusText} ${txt}`);
        }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content ?? data;
        return { resolvedMessages: resolved, modelOutput: content, usedFallback: true };
    }
}
export async function migrateTo120Text(text) {
    const obj = JSON.parse(text);
    const sdk = await importCoreSafely();
    const migrate = sdk?.migrateTo120 || sdk?.default?.migrateTo120 || sdk?.migratePrompt || sdk?.default?.migratePrompt;
    const migrated = migrate ? await migrate(obj) : obj;
    return JSON.stringify(migrated, null, 2);
}
export async function diffPromptKeysText(aText, bText) {
    try {
        const a = JSON.parse(aText);
        const b = JSON.parse(bText);
        const sdk = await importCoreSafely();
        const diff = sdk?.diffPromptKeys || sdk?.default?.diffPromptKeys;
        if (diff) {
            return diff(a, b);
        }
        // Fallback: shallow top-level key diff
        const aKeys = new Set(Object.keys(a || {}));
        const bKeys = new Set(Object.keys(b || {}));
        const onlyInA = [...aKeys].filter((k) => !bKeys.has(k));
        const onlyInB = [...bKeys].filter((k) => !aKeys.has(k));
        const shared = [...aKeys].filter((k) => bKeys.has(k));
        const changed = shared.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
        return { onlyInA, onlyInB, changed };
    }
    catch (e) {
        return { error: e?.message || String(e) };
    }
}
async function readBundledSchema() {
    // Try dist/schema first (copied during build), then fall back to src/schema when running from source
    const fs = await import('node:fs/promises');
    try {
        const url = new URL('../schema/gptp.schema.json', import.meta.url);
        const content = await fs.readFile(url, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        try {
            const url2 = new URL('../../src/schema/gptp.schema.json', import.meta.url);
            const content2 = await fs.readFile(url2, 'utf-8');
            return JSON.parse(content2);
        }
        catch {
            return undefined;
        }
    }
}
let cachedSchemaObj;
let cachedAjvCtor;
let cachedAjvInstance;
let cachedValidatorFn;
let compilePromise;
async function validateWithLocalSchema(obj) {
    try {
        // Load and cache schema and validator; compile Ajv in background on first run to avoid blocking the extension host
        if (!cachedValidatorFn) {
            if (!compilePromise) {
                compilePromise = (async () => {
                    if (!cachedSchemaObj) {
                        cachedSchemaObj = await readBundledSchema();
                    }
                    const schema = cachedSchemaObj;
                    if (!schema) {
                        return;
                    }
                    if (!cachedAjvCtor) {
                        const modAjv = await import('ajv');
                        cachedAjvCtor = modAjv?.default ?? modAjv;
                    }
                    if (!cachedAjvInstance) {
                        cachedAjvInstance = new cachedAjvCtor({ allErrors: true });
                    }
                    if (!cachedValidatorFn) {
                        cachedValidatorFn = cachedAjvInstance.compile(schema);
                    }
                })().catch(() => { });
            }
            // If compilation hasn't finished yet, return a fast success with no issues to keep UI responsive
            return { valid: true, issues: [] };
        }
        const validateFn = cachedValidatorFn;
        const valid = validateFn(obj);
        const text = JSON.stringify(obj);
        const errors = validateFn.errors || [];
        const issues = await Promise.all(errors.map(async (e) => {
            const jsonPointer = e.instancePath || e.dataPath || '';
            const loc = await jsonPointerToOffset(text, jsonPointer);
            return { message: e.message || 'Validation error', jsonPointer, ...loc };
        }));
        return { valid, issues };
    }
    catch {
        return undefined;
    }
}
async function jsonPointerToOffset(text, pointer) {
    try {
        if (!pointer || pointer === '') {
            return {};
        }
        const mod = await import('jsonc-parser');
        const parseTree = mod.parseTree;
        const findNodeAtLocation = mod.findNodeAtLocation;
        const tree = parseTree(text);
        const path = pointer
            .split('/')
            .slice(1)
            .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
        const node = tree ? findNodeAtLocation(tree, path) : undefined;
        if (!node) {
            return {};
        }
        return { offset: node.offset, length: node.length };
    }
    catch {
        return {};
    }
}
// --- Local helpers (SDK fallback) ---
function localInspect(obj) {
    const variablesArray = normalizeVariables(obj?.variables);
    const messages = Array.isArray(obj?.messages) ? obj.messages : [];
    return {
        variables: variablesArray,
        messages,
        resolvedMessages: messages,
    };
}
function normalizeVariables(vars) {
    if (!vars) {
        return [];
    }
    if (Array.isArray(vars)) {
        return vars.map((v) => typeof v === 'string' ? { name: v } : { name: v.name, required: v.required, description: v.description, example: v.example }).filter((v) => !!v?.name);
    }
    if (typeof vars === 'object') {
        return Object.keys(vars).map((k) => ({ name: k, ...(typeof vars[k] === 'object' ? vars[k] : {}) }));
    }
    return [];
}
function buildVariableMap(obj) {
    const arr = normalizeVariables(obj?.variables);
    const out = {};
    for (const v of arr) {
        out[v.name] = v.example ?? '';
    }
    return out;
}
function interpolate(s, ctx) {
    return s.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, key) => {
        const v = ctx[key];
        return (v === null || v === undefined) ? '' : String(v);
    });
}
//# sourceMappingURL=gptpService.js.map