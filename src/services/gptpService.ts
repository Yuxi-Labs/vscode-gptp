// Use dynamic import to interop with ESM SDK; indirection avoids bundlers trying to include it
async function core(): Promise<any> {
  const segA = '@yuxilabs';
  const segB = '/gptp-core';
  const pkg = segA + segB;
  // Use eval-based import to avoid bundler resolution
  const din = (0, eval)('import');
  return await din(pkg);
}

// Avoid long stalls on SDK import/usage by racing with a timeout and falling back to local logic
async function importCoreSafely(timeoutMs = 250): Promise<any | undefined> {
  try {
    const timer = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs));
    // Race the real import with a short timeout; if it loses the race, return undefined and use fallbacks
    return await Promise.race([core(), timer]);
  } catch {
    return undefined;
  }
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
  // Editing-time validation uses a fast local validator to stay responsive
  const quick = await quickValidate(obj, text);
  return quick;
  } catch (err: any) {
    // Final fallback: try local schema validation if JSON parsed successfully
    try {
      const isString = typeof textOrObj === 'string';
      const text = isString ? (textOrObj as string) : JSON.stringify(textOrObj);
      const obj = isString ? JSON.parse(text) : textOrObj;
      return await quickValidate(obj, text);
    } catch {}
    return { valid: false, issues: [{ message: 'Invalid JSON' }] };
  }
}

async function quickValidate(obj: any, text: string): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
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

async function objectItemRange(text: string, path: (string|number)[]): Promise<{ offset?: number; length?: number }> {
  try {
    const mod = await import('jsonc-parser');
    const parseTree = (mod as any).parseTree as (t: string) => any;
    const findNodeAtLocation = (mod as any).findNodeAtLocation as (tree: any, p: (string|number)[]) => any;
    const tree = parseTree(text);
    const node = tree ? findNodeAtLocation(tree, path) : undefined;
    if (node) { return { offset: node.offset, length: node.length }; }
    return {};
  } catch { return {}; }
}

async function pointerOrObjectRange(text: string, path: (string|number)[]): Promise<{ offset?: number; length?: number }> {
  const pointer = '/' + path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
  const byPointer = await jsonPointerToOffset(text, pointer);
  if (byPointer.offset !== undefined) { return byPointer; }
  return objectItemRange(text, path);
}

export async function getInspection(text: string) {
  try {
    const obj = JSON.parse(text);
  // Editing-time inspection uses local logic only to avoid heavy imports
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
  // Local preview: naive variable interpolation only (no provider calls)
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
  return importCoreSafely().then((sdk) => {
    const fn = sdk?.formatPrompt || sdk?.default?.formatPrompt || sdk?.formatOutput || sdk?.default?.formatOutput;
    return fn ? fn(raw, opts || {} as any) : String(raw?.content ?? '');
  });
}

// Execute with provider calls enabled (run:true). Throws if SDK not available.
export async function executeRun(
  text: string,
  input?: Record<string, any>,
  options?: {
    validate?: boolean;
    timeoutMs?: number;
    retry?: { retries?: number; baseDelayMs?: number; maxDelayMs?: number; jitter?: boolean };
    lockfilePath?: string;
    httpFallback?: {
      baseUrl: string;
      model: string;
      temperature?: number;
      apiKey?: string;
    };
  }
): Promise<{ resolvedMessages: any[]; modelOutput: any; renderedPromptHash?: string; variablesHash?: string; usedFallback?: boolean }>
{
  const obj = JSON.parse(text);
  try {
    const sdk = await importCoreSafely();
    const fn = (sdk as any)?.executePrompt || (sdk as any)?.default?.executePrompt;
    if (!fn) { throw new Error('missing executePrompt'); }
    const res = await fn(obj, {
      input: input || {},
      run: true,
      validate: options?.validate ?? true,
      timeoutMs: options?.timeoutMs,
      retry: options?.retry,
      lockfilePath: options?.lockfilePath,
    });
  return { ...res, usedFallback: false };
  } catch (err) {
    // HTTP fallback to OpenAI-compatible API if configured
  const fb = options?.httpFallback;
  if (!fb || !fb.baseUrl || !fb.model) {
      throw err;
    }
    // Build resolved messages locally (simple interpolation fallback)
    const vars = buildVariableMap(obj);
    const resolved = Array.isArray(obj.messages) ? obj.messages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? interpolate(m.content, { ...vars, ...(input || {}) }) : m.content
    })) : [];
    const base = fb.baseUrl.replace(/\/$/, '');
    const url = base + '/chat/completions';
    const body = {
      model: fb.model,
      messages: resolved.map((m: any) => ({ role: m.role, content: m.content })),
      temperature: typeof fb.temperature === 'number' ? fb.temperature : 0.7,
    } as any;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (fb.apiKey) { headers['authorization'] = `Bearer ${fb.apiKey}`; }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) } as any);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP fallback failed: ${res.status} ${res.statusText} ${txt}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? data;
  return { resolvedMessages: resolved, modelOutput: content, usedFallback: true };
  }
}

export async function migrateTo120Text(text: string) {
  const obj = JSON.parse(text);
  const sdk = await importCoreSafely();
  const migrate = sdk?.migrateTo120 || sdk?.default?.migrateTo120 || sdk?.migratePrompt || sdk?.default?.migratePrompt;
  const migrated = migrate ? await migrate(obj) : obj;
  return JSON.stringify(migrated, null, 2);
}

export async function diffPromptKeysText(aText: string, bText: string) {
  try {
    const a = JSON.parse(aText);
    const b = JSON.parse(bText);
  const sdk = await importCoreSafely();
  const diff = sdk?.diffPromptKeys || sdk?.default?.diffPromptKeys;
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

let cachedSchemaObj: any | undefined;
let cachedAjvCtor: any | undefined;
let cachedAjvInstance: any | undefined;
let cachedValidatorFn: ((data: any) => boolean) | undefined;
let compilePromise: Promise<void> | undefined;

async function validateWithLocalSchema(obj: any): Promise<ValidationResult | undefined> {
  try {
    // Load and cache schema and validator; compile Ajv in background on first run to avoid blocking the extension host
    if (!cachedValidatorFn) {
      if (!compilePromise) {
        compilePromise = (async () => {
          if (!cachedSchemaObj) {
            cachedSchemaObj = await readBundledSchema();
          }
          const schema = cachedSchemaObj;
          if (!schema) { return; }
          if (!cachedAjvCtor) {
            const modAjv: any = await import('ajv');
            cachedAjvCtor = (modAjv as any)?.default ?? (modAjv as any);
          }
          if (!cachedAjvInstance) {
            cachedAjvInstance = new cachedAjvCtor({ allErrors: true });
          }
          if (!cachedValidatorFn) {
            cachedValidatorFn = cachedAjvInstance.compile(schema as any);
          }
        })().catch(() => { /* ignore */ });
      }
      // If compilation hasn't finished yet, return a fast success with no issues to keep UI responsive
      return { valid: true, issues: [] };
    }
    const validateFn = cachedValidatorFn as ((data: any) => boolean);
    const valid = validateFn(obj) as boolean;
    const text = JSON.stringify(obj);
    const errors = (validateFn as any).errors || [];
    const issues: ValidationIssue[] = await Promise.all(errors.map(async (e: any) => {
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
  return (v === null || v === undefined) ? '' : String(v);
  });
}
