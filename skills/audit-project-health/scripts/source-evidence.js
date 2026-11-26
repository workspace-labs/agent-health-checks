"use strict";

function isExplicitNodeCli(text) {
  return /^#![^\r\n]*\bnode(?:\s|$)/.test(String(text || ""));
}

function sourceTokens(text, timeExpired) {
  const source = String(text || "");
  const tokens = [];
  const interpolations = [];
  const controlParens = [];
  let nextTimeCheck = 8192;
  let inTemplate = false;
  const regexPrefixWords = new Set([
    "await", "case", "delete", "do", "else", "in", "instanceof", "new",
    "of", "return", "throw", "typeof", "void", "yield",
  ]);
  let canStartRegex = true;

  for (let i = 0; i < source.length;) {
    if (i >= nextTimeCheck) {
      if (timeExpired()) return null;
      nextTimeCheck = i + 8192;
    }
    const char = source[i];
    const next = source[i + 1];

    if (inTemplate) {
      if (char === "\\") i += 2;
      else if (char === "`") { i++; inTemplate = false; canStartRegex = false; }
      else if (char === "$" && next === "{") {
        tokens.push({ value: "{", index: i });
        interpolations.push(0);
        i += 2;
        inTemplate = false;
        canStartRegex = true;
      } else i++;
      continue;
    }

    if (/\s/.test(char)) { i++; continue; }

    if ((char === "/" && next === "/") || (i === 0 && char === "#" && next === "!")) {
      i += 2;
      while (i < source.length && !/[\r\n\u2028\u2029]/.test(source[i])) i++;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(source.length, i + 2);
      continue;
    }
    if (char === "`") {
      tokens.push({ value: char, index: i++ });
      inTemplate = true;
      continue;
    }
    if (char === "'" || char === '"') {
      const start = i;
      const quote = char;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      tokens.push({ value: source.slice(start, i), index: start });
      canStartRegex = false;
      continue;
    }
    if (char === "/" && canStartRegex) {
      tokens.push({ value: "/", index: i });
      let inClass = false;
      i++;
      while (i < source.length && !/[\r\n\u2028\u2029]/.test(source[i])) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        else if (source[i] === "/" && !inClass) { i++; break; }
        i++;
      }
      while (/[a-z]/i.test(source[i] || "")) i++;
      canStartRegex = false;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = i;
      i++;
      while (/[A-Za-z0-9_$]/.test(source[i] || "")) i++;
      const word = source.slice(start, i);
      tokens.push({ value: word, index: start, interpolation: interpolations.length > 0 });
      canStartRegex = regexPrefixWords.has(word);
      continue;
    }
    if (/[0-9]/.test(char)) {
      const start = i++;
      while (/[A-Za-z0-9_.]/.test(source[i] || "")) i++;
      tokens.push({ value: source.slice(start, i), index: start });
      canStartRegex = false;
      continue;
    }

    if (interpolations.length) {
      const top = interpolations.length - 1;
      if (char === "{") interpolations[top]++;
      else if (char === "}") {
        if (interpolations[top]) interpolations[top]--;
        else { interpolations.pop(); inTemplate = true; }
      }
    }
    const value = source.startsWith("===", i) ? "===" : source.startsWith("==", i) ? "==" : char;
    if (value === "(") {
      const previous = tokens.at(-1);
      const control = /^(?:if|for|while|with)$/.test(previous?.value) && tokens.at(-2)?.value !== ".";
      controlParens.push(control);
      tokens.push({ value, index: i, expressionStart: canStartRegex || previous?.endsControl });
    } else if (value === ")") {
      tokens.push({ value, index: i, endsControl: controlParens.pop() });
    } else {
      tokens.push({ value, index: i });
    }
    canStartRegex = /[({[,:;=!?&|+\-*%^~<>]/.test(char);
    i += value.length;
  }
  return tokens;
}

const electronRules = new Map([
  ["nodeIntegration", ["true", "electron-node-integration", "nodeIntegration is enabled in an Electron renderer.", "Untrusted renderer content may gain direct Node.js access.", "Disable nodeIntegration and expose a narrow context-isolated preload API."]],
  ["contextIsolation", ["false", "electron-context-isolation", "Electron context isolation is disabled.", "Page scripts may interfere with privileged preload state.", "Enable contextIsolation and keep the bridge narrowly scoped."]],
  ["webSecurity", ["false", "electron-web-security", "Electron web security is disabled.", "The renderer loses important browser-origin protections.", "Restore webSecurity unless a narrowly documented exception is essential."]],
  ["sandbox", ["false", "electron-sandbox-disabled", "The Electron renderer sandbox is explicitly disabled.", "A renderer compromise may have a larger impact.", "Enable the sandbox when compatible, or document and verify the required exception."]],
]);

function optionName(value) {
  return value && (value[0] === '"' || value[0] === "'") ? value.slice(1, -1) : value;
}

// Intern static property paths. A reference to config.window identifies that
// particular object, without making config itself a window settings object.
// Identities avoid building increasingly long strings in nested object literals.
function windowSandboxIndex(tokens, timeExpired) {
  const root = {};
  const objects = [];
  const candidates = new Map();
  const preferences = new Set();
  const value = i => tokens[i]?.value;
  const identifier = name => name && /^[A-Za-z_$]/.test(name);
  const quoted = token => token && (token[0] === "'" || token[0] === '"');

  function member(parent, key) {
    if (!parent || !key) return null;
    parent.children ??= new Map();
    if (!parent.children.has(key)) parent.children.set(key, {});
    const object = parent.children.get(key);
    if (key === "webPreferences") preferences.add(object);
    return object;
  }
  function pathEndingAt(i) {
    const parts = [];
    while (i >= 0) {
      if (value(i) === "]" && quoted(value(i - 1)) && value(i - 2) === "[") {
        parts.push(optionName(value(i - 1)));
        i -= 3;
      } else if (identifier(value(i))) {
        parts.push(value(i));
        if (value(i - 1) !== ".") {
          let object = root;
          for (let n = parts.length - 1; n >= 0; n--) object = member(object, parts[n]);
          return object;
        }
        i -= 2;
      } else break;
    }
    return null;
  }
  function pathStartingAt(i) {
    if (!identifier(value(i))) return null;
    let object = member(root, value(i++));
    while (i < tokens.length) {
      if (value(i) === "." && identifier(value(i + 1))) {
        object = member(object, value(i + 1));
        i += 2;
      } else if (value(i) === "[" && quoted(value(i + 1)) && value(i + 2) === "]") {
        object = member(object, optionName(value(i + 1)));
        i += 3;
      } else break;
    }
    return object;
  }
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0 && i % 8192 === 0 && timeExpired()) break;
    const current = value(i);
    const previous = value(i - 1);
    const next = value(i + 1);
    if (current === "{") {
      let object;
      if (previous === "=") object = pathEndingAt(i - 2);
      if (previous === ":") object = member(objects.at(-1), optionName(value(i - 2)));
      objects.push(object || {});
    } else if (current === "}") objects.pop();
    const key = optionName(current);
    const property = next === ":" && (previous === "{" || previous === ",");
    const dotted = previous === "." && next === "=";
    const bracket = previous === "[" && next === "]" && value(i + 2) === "=";
    if (!(property || dotted || bracket)) continue;
    const rhs = i + (bracket ? 3 : 2);
    if (key === "webPreferences") {
      const reference = pathStartingAt(rhs);
      if (reference) preferences.add(reference);
    } else if (key === "sandbox" && value(rhs) === "false") {
      const owner = property ? objects.at(-1) : pathEndingAt(i - 2);
      if (owner && !candidates.has(owner)) candidates.set(owner, tokens[i].index);
    }
  }
  for (const [object, index] of candidates) if (preferences.has(object)) return index;
}

const globalEvalReceivers = new Set(["window", "globalThis", "self", "global"]);

function executableEvidence(source, electron, timeExpired) {
  const debug = [];
  const dynamic = [];
  const settings = new Map();
  let mainGuard = false;
  if (!/debugger|eval|Function/.test(source) && !(source.includes("require") && source.includes("main")) &&
      !(electron && /nodeIntegration|contextIsolation|webSecurity|sandbox/.test(source))) {
    return { debug, dynamic, settings, mainGuard };
  }
  const tokens = sourceTokens(source, timeExpired);
  if (!tokens) return null;
  const value = i => tokens[i]?.value;
  // The tokenizer keeps the two punctuation marks in an optional chain separate.
  const afterOptionalChain = i => value(i) === "?" && value(i + 1) === "." ? i + 2 : i;
  const calledAt = i => value(afterOptionalChain(i)) === "(";
  function assignedReference(start, after) {
    if (value(start - 1) !== "=" || !/^[A-Za-z_$]/.test(value(start - 2) || "")) return false;
    const following = value(after);
    if (following === undefined || [";", ",", ")", "}", "]"].includes(following)) return true;
    // A following identifier on a new line can begin a statement through semicolon insertion.
    return /^[A-Za-z_$]/.test(following) && !["in", "instanceof"].includes(following) &&
      /[\n\r\u2028\u2029]/.test(source.slice(tokens[after - 1].index, tokens[after].index));
  }
  function evalEvidenceAt(i) {
    if (value(i - 1) === ".") return;
    let name = i;
    let after = i + 1;
    if (globalEvalReceivers.has(value(i))) {
      const property = value(after) === "." ? after + 1 : afterOptionalChain(after);
      if (value(property) === "[") {
        name = property + 1;
        const literal = value(name);
        // The tokenizer skips template text. Accept only the exact, interpolation-free key.
        if (literal !== '"eval"' && literal !== "'eval'" &&
            !(literal === "`" && source.startsWith("`eval`", tokens[name].index))) return;
        if (value(name + 1) !== "]") return;
        after = name + 2;
      } else {
        if (property === after || value(property) !== "eval") return;
        name = property;
        after = name + 1;
      }
    }
    const throughCall = value(after) === "." && value(after + 1) === "call" && calledAt(after + 2);
    // In fn(0, eval)(x) the second call invokes the function's return value.
    const groupedCall = value(i - 1) === "," && value(i - 2) === "0" && tokens[i - 3]?.expressionStart &&
      value(after) === ")" && calledAt(after + 1);
    if (calledAt(after) || throughCall || groupedCall || assignedReference(i, after)) return tokens[name].index;
  }
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0 && i % 8192 === 0 && timeExpired()) return null;
    const { value: current, index } = tokens[i];
    const previous = value(i - 1);
    const next = value(i + 1);
    if (current === "debugger" && !tokens[i].interpolation) {
      let end = index + current.length;
      while (source[end] === " " || source[end] === "\t" || source[end] === "\r") end++;
      if (source[end] === ";" || source[end] === "\n" || end === source.length) debug.push(index);
    }
    if (current === "eval" || globalEvalReceivers.has(current)) {
      const evidence = evalEvidenceAt(i);
      if (evidence !== undefined) dynamic.push(evidence);
    }
    if (current === "new" && next === "Function" && value(i + 2) === "(") dynamic.push(index);
    if (current === "require" && previous !== "." && next === "." && value(i + 2) === "main" &&
        value(i + 3) === "===" && value(i + 4) === "module") mainGuard = true;
    if (!electron) continue;
    const key = optionName(current);
    const rule = electronRules.get(key);
    if (!rule) continue;
    const property = next === ":" && ["{", ","].includes(previous);
    const assigned = previous === "." && next === "=";
    const bracket = previous === "[" && next === "]" && value(i + 2) === "=";
    if (!(property || assigned || bracket) || value(i + (bracket ? 3 : 2)) !== rule[0]) continue;
    if (!settings.has(key)) settings.set(key, index);
  }
  if (settings.has("sandbox")) {
    const index = windowSandboxIndex(tokens, timeExpired);
    if (index === undefined) settings.delete("sandbox");
    else settings.set("sandbox", index);
  }
  return { debug, dynamic, settings, mainGuard };
}

module.exports = { isExplicitNodeCli, electronRules, executableEvidence };
