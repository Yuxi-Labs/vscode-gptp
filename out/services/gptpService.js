// Use dynamic import to interop with ESM SDK; indirection avoids bundlers trying to include it
async function core() {
    const segA = '@yuxilabs';
    const segB = '/gptp-core';
    const pkg = segA + segB;
    // Use eval-based import to avoid bundler resolution
    const din = (0, eval)('import');
    return await din(pkg);
}
export async function validateText(textOrObj) {
    try {
        const isString = typeof textOrObj === 'string';
        const text = isString ? textOrObj : JSON.stringify(textOrObj);
        const obj = isString ? JSON.parse(text) : textOrObj;
        let res;
        try {
            const sdk = await core();
            const validatePrompt = sdk.validatePrompt || sdk.default?.validatePrompt;
            if (validatePrompt) {
                res = await validatePrompt(obj);
            }
        }
        catch {
            // ignore SDK load/validate errors; we'll fall back to local schema
        }
        if (!res) {
            const fb = await validateWithLocalSchema(obj);
            if (fb) {
                return fb;
            }
            return { valid: false, issues: [{ message: 'Validation unavailable' }] };
        }
        // If remote schema resolution fails, attempt local fallback
        if (!res?.valid && (!res?.errors || res.errors.length === 0)) {
            const fallback = await validateWithLocalSchema(obj);
            if (fallback) {
                return fallback;
            }
        }
        const issues = await Promise.all((res.errors || []).map(async (e) => {
            const jsonPointer = e.instancePath || e.dataPath || '';
            const loc = await jsonPointerToOffset(text, jsonPointer);
            return { message: e.message || 'Validation error', jsonPointer, ...loc };
        }));
        return { valid: !!res.valid, issues };
    }
    catch (err) {
        // Final fallback: try local schema validation if JSON parsed successfully
        try {
            const isString = typeof textOrObj === 'string';
            const obj = isString ? JSON.parse(textOrObj) : textOrObj;
            const fb = await validateWithLocalSchema(obj);
            if (fb) {
                return fb;
            }
        }
        catch { }
        return { valid: false, issues: [{ message: 'Invalid JSON' }] };
    }
}
export async function getInspection(text) {
    try {
        const obj = JSON.parse(text);
        try {
            const sdk = await core();
            const fn = sdk.inspectPrompt || sdk.default?.inspectPrompt;
            if (fn) {
                return fn(obj);
            }
        }
        catch { }
        // Local fallback inspection
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
    try {
        const sdk = await core();
        const fn = sdk.executePrompt || sdk.default?.executePrompt;
        if (fn) {
            return fn(obj, { input: input || {}, run: false });
        }
    }
    catch { }
    // Local preview fallback: naive variable interpolation only
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
    return core().then((sdk) => {
        const fn = sdk.formatPrompt || sdk.default?.formatPrompt || sdk.formatOutput || sdk.default?.formatOutput;
        return fn ? fn(raw, opts || {}) : String(raw?.content ?? '');
    });
}
export async function migrateTo120Text(text) {
    const obj = JSON.parse(text);
    const sdk = await core();
    const migrate = sdk.migrateTo120 || sdk.default?.migrateTo120 || sdk.migratePrompt || sdk.default?.migratePrompt;
    const migrated = migrate ? await migrate(obj) : obj;
    return JSON.stringify(migrated, null, 2);
}
export async function diffPromptKeysText(aText, bText) {
    try {
        const a = JSON.parse(aText);
        const b = JSON.parse(bText);
        const sdk = await core();
        const diff = sdk.diffPromptKeys || sdk.default?.diffPromptKeys;
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
async function validateWithLocalSchema(obj) {
    try {
        const schema = await readBundledSchema();
        if (!schema) {
            return undefined;
        }
        const Ajv = (await import('ajv')).default;
        const ajv = new Ajv({ allErrors: true });
        const validate = ajv.compile(schema);
        const valid = validate(obj);
        const text = JSON.stringify(obj);
        const issues = await Promise.all((validate.errors || []).map(async (e) => {
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
        return v == null ? '' : String(v);
    });
}
//# sourceMappingURL=gptpService.js.map