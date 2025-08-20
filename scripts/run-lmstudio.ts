#!/usr/bin/env -S node
// Minimal GPTP 14 LM Studio runner (TypeScript) using native fetch.
// Usage (Windows cmd):
//   npm run lmstudio -- --file path\to\prompt.gptp --model your-local-model [--input path\to\vars.json] [--var k=v ...] [--base http://localhost:1234/v1] [--temperature 0.7]

import { readFile } from 'node:fs/promises';

type PromptVar = { name: string; example?: string } & Record<string, unknown>;
type Prompt = { variables?: PromptVar[] | Record<string, unknown>; messages?: Array<{ role: string; content?: string }> } & Record<string, unknown>;

function parseArgs(argv: string[]) {
  const out: any = {
    base: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1',
    // allow overriding default model via env or CLI
    model: process.env.LMSTUDIO_MODEL || 'openai/gpt-oss-20b',
    vars: {},
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--input') out.input = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--base') out.base = argv[++i];
    else if (a === '--temperature') out.temperature = Number(argv[++i]);
    else if (a === '--var') {
      const kv = argv[++i];
      const eq = kv.indexOf('=');
      if (eq > 0) out.vars[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  return out as { file?: string; input?: string; model?: string; base: string; temperature?: number; vars: Record<string, string> };
}

function normalizeVariables(vars: any): PromptVar[] {
  if (!vars) return [];
  if (Array.isArray(vars)) return vars as PromptVar[];
  if (typeof vars === 'object') return Object.keys(vars).map((k) => ({ name: k, ...(typeof vars[k] === 'object' ? (vars[k] as object) : {}) }));
  return [];
}

function buildVariableMap(prompt: Prompt, overrides: Record<string, string>) {
  const arr = normalizeVariables(prompt.variables);
  const out: Record<string, string> = {};
  for (const v of arr) out[v.name] = overrides?.[v.name] ?? String((v as any).example ?? '');
  return out;
}

function interpolate(str: unknown, ctx: Record<string, string>) {
  return String(str).replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, k) => (ctx[k] == null ? '' : String(ctx[k])));
}

function resolveMessages(prompt: Prompt, ctx: Record<string, string>) {
  const messages = Array.isArray(prompt.messages) ? prompt.messages : [];
  return messages.map((m) => ({ role: m.role, content: interpolate(m.content ?? '', ctx) }));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: --file <path.gptp> [--model <model>] [--input inputs.json | --var k=v ...] [--base http://localhost:1234/v1] [--temperature 0.7]');
    process.exit(2);
  }
  const text = await readFile(args.file, 'utf8');
  const prompt = JSON.parse(text) as Prompt;

  // use model from CLI env/args (args.model is populated from env default above)
  if (!args.model) args.model = process.env.LMSTUDIO_MODEL || 'openai/gpt-oss-20b';
  console.error(`LM Studio runner: using model=${args.model} base=${args.base}`);

  let provided: Record<string, string> = {};
  if (args.input) provided = JSON.parse(await readFile(args.input, 'utf8'));
  provided = { ...provided, ...args.vars };

  const vars = buildVariableMap(prompt, provided);
  const messages = resolveMessages(prompt, vars);

  const body: any = {
    model: args.model,
    messages,
    temperature: Number.isFinite(args.temperature as number) ? args.temperature : undefined,
  };

  // Prefer programmatic SDK if installed; fall back to OpenAI-compatible HTTP API
  try {
  // @ts-ignore: optional dependency, only loaded if present at runtime
  const lm = await import('@lmstudio/sdk');
    if (lm?.LMStudioClient) {
      const LMStudioClient = lm.LMStudioClient as any;
      const client = new LMStudioClient({ baseUrl: args.base, apiKey: process.env.LMSTUDIO_API_KEY });
      // try to use a chat-style API if available via the SDK
      if (client.llm && typeof client.llm.model === 'function') {
        const sdkModel = await client.llm.model(args.model as string);
        // prefer to call respond with a concatenated message if SDK expects text
        const joined = messages.map((m: any) => `${m.role}: ${m.content ?? ''}`).join('\n\n');
        const sdkRes = await sdkModel.respond(joined);
        const sdkContent = sdkRes?.content ?? sdkRes?.choices?.[0]?.message?.content ?? '';
        console.log(sdkContent);
        return;
      }
    }
  } catch (e) {
    // SDK not installed or errored; fall back to HTTP fetch below
  }

  // Always join /chat/completions to the base, never overwrite the path
  const endpoint = args.base.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // LM Studio ignores the key but some proxies require it
      authorization: `Bearer ${process.env.LMSTUDIO_API_KEY || 'lm-studio'}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LM Studio request failed: ${res.status} ${res.statusText}\n${errText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  console.log(content);
}

main().catch((e) => { console.error((e as any)?.stack || (e as any)?.message || String(e)); process.exit(1); });
