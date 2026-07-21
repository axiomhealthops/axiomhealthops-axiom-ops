// =====================================================================
// check-undefined-refs.mjs        run with:  npm run check:refs
//
// Catches identifiers that are referenced but never declared, imported, or
// provided by the runtime — i.e. the exact failure that blanked the whole
// dashboard on 2026-07-21.
//
// WHY THIS EXISTS
// `vite build` does NOT catch this. esbuild resolves imports and syntax,
// but an undeclared identifier is a perfectly valid reference to a global
// at build time; it only explodes as "X is not defined" when the module
// runs. A refactor deleted ~150 lines containing 18 top-level helpers
// (COLS, BUCKET_STYLE, fmtDate, todayISO, bucketOf...) that were still
// referenced. The build passed. The page went white.
//
// Scope analysis via @babel/traverse, which ships with @vitejs/plugin-react,
// so this adds no dependency.
// =====================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// Browser + JS globals that are legitimately undeclared in module scope.
const GLOBALS = new Set([
  'window', 'document', 'console', 'navigator', 'location', 'history', 'screen',
  'fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File', 'FileReader',
  'URL', 'URLSearchParams', 'AbortController', 'WebSocket', 'EventSource',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage',
  'alert', 'confirm', 'prompt', 'atob', 'btoa', 'structuredClone', 'crypto',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math',
  'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'globalThis', 'undefined',
  'NaN', 'Infinity', 'Uint8Array', 'ArrayBuffer', 'DataView', 'TextEncoder',
  'TextDecoder', 'performance', 'process', 'Image', 'Audio', 'CustomEvent', 'Event',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'getComputedStyle',
  'HTMLElement', 'Node', 'DOMParser', 'XMLHttpRequest', 'matchMedia', 'open',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(name)) out.push(p);
  }
  return out;
}

const problems = [];
for (const file of walk(SRC)) {
  const code = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
    });
  } catch (e) {
    problems.push({ file, name: `PARSE ERROR: ${e.message}`, line: e.loc?.line ?? 0 });
    continue;
  }

  traverse(ast, {
    Program(path) {
      // Babel records every reference it could not bind to a scope.
      for (const [name, refPaths] of Object.entries(path.scope.globals ? {} : {})) void [name, refPaths];
      const seen = new Set();
      path.traverse({
        ReferencedIdentifier(p) {
          const { name } = p.node;
          if (GLOBALS.has(name) || seen.has(name)) return;
          if (p.scope.hasBinding(name, /* noGlobals */ true)) return;
          seen.add(name);
          problems.push({ file, name, line: p.node.loc?.start.line ?? 0 });
        },
      });
    },
  });
}

if (problems.length === 0) {
  console.log('No undefined references found.');
  process.exit(0);
}
console.log(`${problems.length} undefined reference(s):\n`);
for (const p of problems) {
  console.log(`  ${relative(ROOT, p.file)}:${p.line}  ${p.name}`);
}
process.exit(1);
