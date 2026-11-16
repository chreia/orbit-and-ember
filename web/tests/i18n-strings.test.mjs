// Every word a reader sees goes through the dictionaries (src/i18n.tsx, src/i18n.extra.ts), so the
// interface can be read in English, Spanish and Patwa. This test parses every .tsx file under src and
// fails on English left in the markup: JSX text, string literals placed as JSX children (also inside
// a ternary or &&), and string values of the attributes people read (title, aria-label, placeholder,
// alt). Brand and product names, units and symbols are allowed below.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { parseAst } from 'rolldown/parseAst';

const ROOT = new URL('../src/', import.meta.url).pathname;
const READ_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'aria-description', 'aria-roledescription', 'aria-valuetext']);
/** Names that stay the same in every language, and notation. Matched against the trimmed text. */
const ALLOW = new Set([
  'Focos',
  'Orbit and Ember',
  'NASA FIRMS',
  'GWIS',
  'MW',
  'UTC',
  'DOI',
  'N ↑',
  'W A S D',
  'Q / E',
  'Shift',
  'z = (log(1 + x) − median_c) / max(1.4826 · MAD_c, 0.3)',
  '© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles',
  'SRTMGL1 v3 DOI',
]);
/** Identifiers: DOIs and their labels. */
const ALLOW_RE = [/^(· )?DOI$/i, /^doi:$/i, /^10\.\d{4,9}\/\S+$/];
const LETTER = /\p{L}/u;

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

function lineOf(src, at) {
  return src.slice(0, at).split('\n').length;
}

/** String pieces an expression would print as JSX text: literals, template text, both arms of ?: and &&. */
function printed(node, out) {
  if (!node) return;
  if (node.type === 'Literal' && typeof node.value === 'string') out.push([node.value, node.start]);
  else if (node.type === 'TemplateLiteral') for (const q of node.quasis) out.push([q.value.cooked ?? q.value.raw, q.start]);
  else if (node.type === 'ConditionalExpression') {
    printed(node.consequent, out);
    printed(node.alternate, out);
  } else if (node.type === 'LogicalExpression') printed(node.right, out);
  else if (node.type === 'ParenthesizedExpression') printed(node.expression, out);
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (typeof node.type === 'string') visit(node);
  for (const k in node) if (k !== 'parent') walk(node[k], visit);
}

function offenders(path) {
  const src = readFileSync(path, 'utf8');
  const ast = parseAst(src, { lang: 'tsx' }, path);
  const found = [];
  const check = (text, at, what) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t && LETTER.test(t) && !ALLOW.has(t) && !ALLOW_RE.some((r) => r.test(t))) found.push(`${relative(ROOT, path)}:${lineOf(src, at)} ${what} "${t.slice(0, 70)}"`);
  };
  walk(ast, (n) => {
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') {
      for (const c of n.children) {
        if (c.type === 'JSXText') check(c.value, c.start, 'text');
        else if (c.type === 'JSXExpressionContainer') {
          const pieces = [];
          printed(c.expression, pieces);
          for (const [s, at] of pieces) check(s, at, 'child');
        }
      }
    } else if (n.type === 'JSXAttribute' && n.name?.type === 'JSXIdentifier' && READ_ATTRS.has(n.name.name) && n.value) {
      const pieces = [];
      if (n.value.type === 'Literal') pieces.push([String(n.value.value), n.value.start]);
      else if (n.value.type === 'JSXExpressionContainer') printed(n.value.expression, pieces);
      for (const [s, at] of pieces) check(s, at, n.name.name);
    }
  });
  return found;
}

test('no English is left in the markup outside the dictionaries', () => {
  const all = [...new Set(files(ROOT).flatMap(offenders))];
  assert.deepEqual(all, [], `${all.length} strings to move into src/i18n.extra.ts:\n${all.join('\n')}`);
});

test('later string modules never reuse a key, so one cannot silently replace another', async () => {
  const { enCore } = await import('../src/i18n.extra.ts');
  const parts = { core: enCore };
  for (const m of ['ember', 'live', 'terrain', 'world']) parts[m] = (await import(`../src/strings/${m}.ts`)).en;
  // the first-pass keys, read from the English dictionary in i18n.tsx
  const base = readFileSync(join(ROOT, 'i18n.tsx'), 'utf8');
  const enBlock = base.slice(base.indexOf('const en = {'), base.indexOf('export type Key'));
  const seen = new Map([...enBlock.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((m) => [m[1], 'i18n.tsx']));
  const clashes = [];
  for (const [name, dict] of Object.entries(parts)) {
    for (const k of Object.keys(dict)) {
      if (seen.has(k)) clashes.push(`${k}: ${seen.get(k)} and ${name}`);
      else seen.set(k, name);
    }
  }
  assert.deepEqual(clashes, []);
});
