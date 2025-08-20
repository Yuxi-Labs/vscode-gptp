// Use dynamic import to interop with ESM SDK; indirection avoids bundlers trying to include it
async function core(): Promise<any> {
  const segA = '@yuxilabs';
  const segB = '/gptp-core';
  const pkg = segA + segB;
  // Use eval-based import to avoid bundler resolution
  const din = (0, eval)('import');
  return await din(pkg);
}

export type ValidationIssue = {
  message: string;
  jsonPointer?: string; // JSON Pointer to the offending location
  offset?: number; // start offset in the JSON text
  length?: number; // length of the range
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

export async function validateText(textOrObj: string | any): Promise<ValidationResult> {
  try {
  const isString = typeof textOrObj === 'string';
  const text = isString ? (textOrObj as string) : JSON.stringify(textOrObj);
  const obj = isString ? JSON.parse(text) : textOrObj;
  let res: any | undefined;
  try {
    const sdk = await core();
    const validatePrompt = sdk.validatePrompt || sdk.default?.validatePrompt;
    if (validatePrompt) {
      res = await validatePrompt(obj);
    }
  } catch {
    // ignore SDK load/validate errors; we'll fall back to local schema
  }
  if (!res) {
    const fb = await validateWithLocalSchema(obj);
    if (fb) { return fb; }
    return { valid: false, issues: [{ message: 'Validation unavailable' }] };
  }
  // If remote schema resolution fails, attempt local fallback
  if (!res?.valid && (!res?.errors || res.errors.length === 0)) {
    const fallback = await validateWithLocalSchema(obj);
    if (fallback) {
      return fallback;
    }
  }
    const issues: ValidationIssue[] = await Promise.all((res.errors || []).map(async (e: any) => {
      const jsonPointer = e.instancePath || e.dataPath || '';
      const loc = await jsonPointerToOffset(text, jsonPointer);
      return { message: e.message || 'Validation error', jsonPointer, ...loc };
    }));
    return { valid: !!res.valid, issues };
  } catch (err: any) {
    // Final fallback: try local schema validation if JSON parsed successfully
    try {
      const isString = typeof textOrObj === 'string';
      const obj = isString ? JSON.parse(textOrObj as string) : textOrObj;
      const fb = await validateWithLocalSchema(obj);
      if (fb) { return fb; }
    } catch {}
    return { valid: false, issues: [{ message: 'Invalid JSON' }] };
  }
}

export async function getInspection(text: string) {
  try {
    const obj = JSON.parse(text);
  try {
    const sdk = await core();
    const fn = sdk.inspectPrompt || sdk.default?.inspectPrompt;
    if (fn) { return fn(obj); }
  } catch {}
  // Local fallback inspection
  return localInspect(obj);
  } catch {
    return undefined;
  }
}

export async function getInspectionSummary(text: string) {
  const info = await getInspection(text);
  if (!info) {return undefined;}
  const variables: string[] = (info.variables || []).map((v: any) => v.name || String(v));
  const required: string[] = (info.variables || []).filter((v: any) => !!v.required).map((v: any) => v.name || String(v));
  const roles: string[] = (info.messages || info.resolvedMessages || []).map((m: any) => m.role).filter(Boolean);
  return { variables, required, roles };
}

export async function executePreview(text: string, input?: Record<string, any>) {
  const obj = JSON.parse(text);
  try {
    const sdk = await core();
    const fn = sdk.executePrompt || sdk.default?.executePrompt;
    if (fn) { return fn(obj, { input: input || {}, run: false }); }
  } catch {}
  // Local preview fallback: naive variable interpolation only
  const vars = buildVariableMap(obj);
  const resolved = Array.isArray(obj.messages) ? obj.messages.map((m: any) => ({
    role: m.role,
    content: typeof m.content === 'string' ? interpolate(m.content, { ...vars, ...(input || {}) }) : m.content
  })) : [];
  return { resolvedMessages: resolved, modelOutput: undefined };
}

export function formatOutput(raw: any, opts?: { outputFormat?: 'markdown'|'json'|'html'|'plain-text'; outputSchema?: any }) {
  // formatPrompt is pure and synchronous per SDK surface
  // but still load via dynamic import to avoid static ESM import
  return core().then((sdk) => {
    const fn = sdk.formatPrompt || sdk.default?.formatPrompt || sdk.formatOutput || sdk.default?.formatOutput;
    return fn ? fn(raw, opts || {} as any) : String(raw?.content ?? '');
  });
}

export async function migrateTo120Text(text: string) {
  const obj = JSON.parse(text);
  const sdk = await core();
  const migrate = sdk.migrateTo120 || sdk.default?.migrateTo120 || sdk.migratePrompt || sdk.default?.migratePrompt;
  const migrated = migrate ? await migrate(obj) : obj;
  return JSON.stringify(migrated, null, 2);
}

export async function diffPromptKeysText(aText: string, bText: string) {
  try {
    const a = JSON.parse(aText);
    const b = JSON.parse(bText);
    const sdk = await core();
    const diff = sdk.diffPromptKeys || sdk.default?.diffPromptKeys;
    if (diff) {return diff(a, b);}
    // Fallback: shallow top-level key diff
    const aKeys = new Set(Object.keys(a || {}));
    const bKeys = new Set(Object.keys(b || {}));
    const onlyInA: string[] = [...aKeys].filter((k) => !bKeys.has(k));
    const onlyInB: string[] = [...bKeys].filter((k) => !aKeys.has(k));
    const shared = [...aKeys].filter((k) => bKeys.has(k));
    const changed: string[] = shared.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    return { onlyInA, onlyInB, changed };
  } catch (e) {
    return { error: (e as any)?.message || String(e) };
  }
}

async function readBundledSchema(): Promise<any> {
  // Try dist/schema first (copied during build), then fall back to src/schema when running from source
  const fs = await import('node:fs/promises');
  try {
    const url = new URL('../schema/gptp.schema.json', import.meta.url);
    const content = await fs.readFile(url, 'utf-8');
    return JSON.parse(content);
  } catch {
    try {
      const url2 = new URL('../../src/schema/gptp.schema.json', import.meta.url);
      const content2 = await fs.readFile(url2, 'utf-8');
      return JSON.parse(content2);
    } catch {
      return undefined;
    }
  }
}

async function validateWithLocalSchema(obj: any): Promise<ValidationResult | undefined> {
  try {
    const schema = await readBundledSchema();
    if (!schema) { return undefined; }
  const Ajv = (await import('ajv')).default;
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema as any);
    const valid = validate(obj) as boolean;
    const text = JSON.stringify(obj);
    const issues: ValidationIssue[] = await Promise.all((validate.errors || []).map(async (e: any) => {
      const jsonPointer = e.instancePath || e.dataPath || '';
      const loc = await jsonPointerToOffset(text, jsonPointer);
      return { message: e.message || 'Validation error', jsonPointer, ...loc };
    }));
    return { valid, issues };
  } catch {
    return undefined;
  }
}

async function jsonPointerToOffset(text: string, pointer: string | undefined): Promise<{ offset?: number; length?: number }> {
  try {
    if (!pointer || pointer === '') { return {}; }
    const mod = await import('jsonc-parser');
    const parseTree = (mod as any).parseTree as (text: string) => any;
    const findNodeAtLocation = (mod as any).findNodeAtLocation as (tree: any, path: (string|number)[]) => any;
    const tree = parseTree(text);
    const path = pointer
      .split('/')
      .slice(1)
      .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
    const node = tree ? findNodeAtLocation(tree, path) : undefined;
    if (!node) { return {}; }
    return { offset: node.offset, length: node.length };
  } catch {
    return {};
  }
}

// --- Local helpers (SDK fallback) ---

function localInspect(obj: any) {
  const variablesArray = normalizeVariables(obj?.variables);
  const messages = Array.isArray(obj?.messages) ? obj.messages : [];
  return {
    variables: variablesArray,
    messages,
    resolvedMessages: messages,
  };
}

function normalizeVariables(vars: any): Array<{ name: string; required?: boolean; description?: string; example?: any }> {
  if (!vars) { return []; }
  if (Array.isArray(vars)) {
    return vars.map((v) => typeof v === 'string' ? { name: v } : { name: v.name, required: v.required, description: v.description, example: v.example }).filter((v) => !!v?.name);
  }
  if (typeof vars === 'object') {
    return Object.keys(vars).map((k) => ({ name: k, ...(typeof vars[k] === 'object' ? vars[k] : {}) }));
  }
  return [];
}

function buildVariableMap(obj: any): Record<string, any> {
  const arr = normalizeVariables(obj?.variables);
  const out: Record<string, any> = {};
  for (const v of arr) {
    out[v.name] = v.example ?? '';
  }
  return out;
}

function interpolate(s: string, ctx: Record<string, any>): string {
  return s.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, key) => {
    const v = ctx[key];
    return v == null ? '' : String(v);
  });
}
