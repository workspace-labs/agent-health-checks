"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { auditProject } = require("../skills/audit-project-health/scripts/audit-project");

function check(t, file, lines, expected, newline = "\n") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "import-markup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, file), lines.join(newline) + newline);
  const { findings } = auditProject({ projectPath: root });
  const broken = findings.filter(item => item.code === "broken-relative-import");
  assert.deepEqual(
    broken.map(item => [item.file, item.line, item.message, item.confidence]),
    expected.map(([line, target]) => [file, line, `Relative import does not resolve: ${target}`, "confirmed"])
  );
}

const quietCases = [
  ["line comment", "a.js", [
    "// const x = require('./old');",
    "module.exports = 1;",
  ]],
  ["block comment", "a.js", [
    "/* import y from './old'; */",
    "module.exports = 1;",
  ]],
  ["jsdoc type", "a.js", [
    "/** @type {import('./types').T} */",
    "const v = 1;",
    "module.exports = v;",
  ]],
  ["single-quoted string", "a.js", [
    "const s = 'const a = require(\"./old\")';",
    "module.exports = s;",
  ]],
  ["double-quoted string", "a.js", [
    "const s = \"import z from './old'\";",
    "module.exports = s;",
  ]],
  ["template text", "a.mjs", [
    "const s = `import q from \"./old\"`;",
    "export default s;",
  ]],
  ["template with ${id}", "a.mjs", [
    "const ids=['a'];",
    "const s = ids.map((id) => `import ${id} from \"./${id}\";`);",
    "export default s;",
  ]],
  ["regex literal", "a.js", [
    "const re = /from \"\\.\\/old\"/;",
    "module.exports = re;",
  ]],
  ["markdown-ish help text", "a.js", [
    "const help = [\"Usage:\", \"  import tool from './tool'\"].join('\\n');",
    "module.exports = help;",
  ]],
];
for (const [label, file, lines] of quietCases) {
  test(`quiet import text: ${label}`, t => check(t, "src/" + file, lines, []));
}

const reactCases = [
  ["lazy after one-line JSX", "App.jsx", [
    "import React from 'react';",
    "const T = () => <h1>Hi</h1>;",
    "const Home = React.lazy(() => import('./pages/Home'));",
    "export default T;",
  ], 3, "./pages/Home"],
  ["dynamic import after JSX text with apostrophe", "Card.jsx", [
    "export function Card() {",
    "  return <p>Don't stop</p>;",
    "}",
    "export const load = () =>",
    "  import('./gone');",
  ], 5, "./gone"],
  ["tsx lazy after JSX", "App.tsx", [
    "import React from 'react';",
    "const T = (): JSX.Element => <div className=\"a\">x</div>;",
    "const P = React.lazy(() => import('./pages/P'));",
    "export default T;",
  ], 3, "./pages/P"],
  ["re-export after JSX", "index.jsx", [
    "const A = () => <span>a</span>;",
    "export { B } from './B';",
    "export default A;",
  ], 2, "./B"],
  ["require after JSX (cjs component)", "c.js", [
    "const React = require('react');",
    "const A = () => <b>a</b>;",
    "const util = require('./util');",
    "module.exports = A;",
  ], 3, "./util"],
  ["import after self-closing tag", "s.jsx", [
    "const A = () => <img src=\"a.png\" />;",
    "const L = () => import('./later');",
    "export default A;",
  ], 2, "./later"],
  ["import after fragment", "f.jsx", [
    "const A = () => <><i>a</i></>;",
    "const L = () => import('./later');",
    "export default A;",
  ], 2, "./later"],
  ["import after multi-line JSX", "m.jsx", [
    "function A() {",
    "  return (",
    "    <ul>",
    "      <li>one</li>",
    "    </ul>",
    "  );",
    "}",
    "export const L = () => import('./later');",
  ], 8, "./later"],
  ["CONTROL import before JSX", "p.jsx", [
    "const L = () => import('./first');",
    "const A = () => <h1>Hi</h1>;",
    "export default A;",
  ], 1, "./first"],
  ["CONTROL plain js", "q.js", [
    "const u = require('./nope');",
    "module.exports = u;",
  ], 1, "./nope"],
];
for (const [label, file, lines, line, target] of reactCases) {
  test(`real import: ${label}`, t => check(t, "src/" + file, lines, [[line, target]], "\r\n"));
}

const lookAlikes = [
  ["comparison", "js", "const smaller = a < b;"],
  ["division", "js", "const share = total / count;"],
  ["TypeScript generic function", "ts", "function identity<T>(x: T) { return x; }"],
  ["TSX generic arrow", "tsx", "const identity = <T,>(x: T) => x;"],
  ["TypeScript assertion", "tsx", "const value = x as Foo;"],
];
for (const [label, extension, expression] of lookAlikes) {
  test(`real import after ${label}`, t => check(t, "src/value." + extension, [
    expression, "export const load = () => import('./missing');",
  ], [[2, "./missing"]]));
}

test("JSX ignores import text inside comments, strings and markup", t => check(t, "src/Help.jsx", [
  "// require('./comment');",
  "const example = \"import('./string')\";",
  "export const Help = () => <code>import('./text')</code>;",
], []));

test("imports remain executable in JSX props, children and after JSX in a .js file", t => check(t, "src/View.js", [
  "export const View = () => (",
  "  <Panel title=\"require('./title')\" load={() => import('./prop')}>",
  "    {ready && <Child icon={require('./child')} />}",
  "  </Panel>",
  ");",
  "export { value } from './after';",
], [[2, "./prop"], [3, "./child"], [6, "./after"]]));

test("a constrained TSX generic keeps imports in its body and after it", t => check(t, "src/Generic.tsx", [
  "const load = <T extends Model>(x: T) => import('./inside');",
  "export { value } from './after';",
], [[1, "./inside"], [2, "./after"]]));

test("a semicolon-free declaration before export default JSX retains the next import", t => check(t, "src/Summary.jsx", [
  "const label = 'summary'",
  "export default <span>{label}</span>",
  "const load = () => import('./missing')",
], [[3, "./missing"]]));

test("a JSX statement after a bare declaration retains the next import", t => check(t, "src/Statement.jsx", [
  "let value",
  "<Component>Don't stop</Component>;",
  "import('./gone');",
], [[3, "./gone"]]));

for (const spacing of [" ", " /* note */ "]) {
  test(`JSX tag names can follow ${JSON.stringify(spacing)}`, t => check(t, "src/Spacing.jsx", [
    `const view = <${spacing}div>Don't stop</div>; import('./one');`,
  ], [[1, "./one"]]));
}

test("type arguments on a TSX component retain its prop imports and the next import", t => check(t, "src/Menu.tsx", [
  "const view = <Menu<Value> key=\"x\" load={() => import('./prop')}>ok</Menu>;",
  "import('./missing');",
], [[1, "./prop"], [2, "./missing"]]));

test("division after a TypeScript non-null assertion retains the next import", t => check(t, "src/Count.tsx", [
  "const view = <Box/>;",
  "const half = count! / 2;",
  "import('./missing');",
], [[3, "./missing"]]));

for (const [label, markup] of [
  ["mismatched closing tag", "<Panel><Row></Panel>"],
  ["unclosed tag", "<Panel>unfinished"],
]) {
  test(`uncertain JSX retains candidates: ${label}`, t => check(t, "src/Unfinished.jsx", [
    "const view = " + markup, "import('./missing');",
  ], [[2, "./missing"]]));
}

test("a plain TypeScript assertion leaves quoted import examples quiet", t => check(t, "src/Hint.ts", [
  "const value = <Hint>input;",
  "const example = \"import('./example')\";",
], []));

test("512 KiB of deeply nested markup, templates and braces completes within one second", () => {
  const { executableImportWordStarts } = require("../skills/audit-project-health/scripts/import-context");
  const open = '<Box>{`text ${({ slot: ';
  const close = '}).slot}`}</Box>';
  const middle = "import('./nested')";
  const end = "; import('./after');";
  const size = 512 * 1024;
  const depth = Math.floor((size - middle.length - end.length) / (open.length + close.length));
  const source = (open.repeat(depth) + middle + close.repeat(depth) + end).padEnd(size);
  assert.equal(Buffer.byteLength(source), size);
  const start = performance.now();
  const words = executableImportWordStarts(source);
  const elapsed = performance.now() - start;
  assert.ok(words.has(source.indexOf(middle)));
  assert.ok(words.has(source.lastIndexOf("import")));
  assert.ok(elapsed < 1000, `reader took ${elapsed.toFixed(1)} ms`);
});
