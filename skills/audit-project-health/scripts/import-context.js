"use strict";

const LINE_BREAK = /[\r\n\u2028\u2029]/;

function skipTrivia(source, index) {
  while (index < source.length) {
    if (/\s/.test(source[index])) index++;
    else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) return source.length;
      index = end + 2;
    } else if (source.startsWith("//", index)) {
      while (index < source.length && !LINE_BREAK.test(source[index])) index++;
    } else break;
  }
  return index;
}

// Import checks need to enter ${...}; the legacy debugger reader deliberately does
// not. Keep this dependency-free reader separate so its context rules cannot alter
// debugger findings. This is lexical evidence, not execution or a module parser.
function executableImportWordStarts(text, filename = "") {
  const source = String(text || "");
  // Plain TypeScript permits angle-bracket type assertions, but not JSX.
  const allowMarkup = !/\.[cm]?ts$/i.test(filename);
  const jsxName = /[\p{ID_Start}$_][\p{ID_Continue}$.:\-\u200c\u200d]*/uy;
  const starts = new Set();
  const prefixWords = new Set([
    "await", "break", "case", "continue", "delete", "do", "else", "in", "instanceof", "new",
    "of", "return", "throw", "typeof", "void", "yield",
  ]);
  let i = 0;

  function nameAt(index) {
    jsxName.lastIndex = index;
    return jsxName.exec(source)?.[0] || "";
  }

  function openElement() {
    const nameStart = skipTrivia(source, i + 1);
    const name = nameAt(nameStart);
    const end = nameStart + name.length;
    if (name ? !/[\s/<>]/.test(source[end] || "") : source[end] !== ">") return false;
    contexts.push({ jsx: "tag", name, start: i });
    i = end;
    return true;
  }

  // An unclosed or ambiguous element is insufficient evidence for suppressing
  // a finding. Restore every candidate in the uncertain suffix in one pass.
  function keepUncertain(from) {
    const outer = contexts.find(frame => frame.jsx);
    const words = /\b(?:import|from|require)\b/g;
    words.lastIndex = outer ? Math.min(outer.start, from) : from;
    let word;
    while ((word = words.exec(source))) starts.add(word.index);
    return starts;
  }

  function quoted(quote) {
    i++;
    while (i < source.length) {
      if (source[i] === "\\") {
        i += source[i + 1] === "\r" && source[i + 2] === "\n" ? 3 : 2;
        continue;
      }
      if (source[i] === "\n" || source[i] === "\r") return false;
      if (source[i++] === quote) return true;
    }
    return false;
  }

  function regex() {
    let inClass = false;
    i++;
    while (i < source.length) {
      if (LINE_BREAK.test(source[i])) return false;
      if (source[i] === "\\") {
        if (LINE_BREAK.test(source[i + 1])) return false;
        i += 2;
        continue;
      }
      const char = source[i++];
      if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) {
        while (/[a-z]/i.test(source[i] || "")) i++;
        return source[i] !== "'" && source[i] !== '"';
      }
    }
    return false;
  }

  function codeContext(interpolation = false) {
    return {
      interpolation, regex: true, statement: !interpolation, previous: "",
      control: false, callable: null, classBody: null, body: null,
      parens: [], braces: [], ternaries: 0,
    };
  }

  function readMarkup(context, char, next) {
    if (char === "{") {
      i++;
      contexts.push(codeContext(true));
    } else if (context.jsx === "text") {
      if (char !== "<") { i++; return true; }
      if (next !== "/") {
        return openElement();
      }
      const nameStart = skipTrivia(source, i + 2);
      const closing = nameAt(nameStart);
      i = skipTrivia(source, nameStart + closing.length);
      if (closing !== context.name || source[i] !== ">") return false;
      contexts.pop();
      i++;
    } else if (char === ">") {
      context.jsx = "text";
      i++;
    } else if (char === "/" && next === ">") {
      contexts.pop();
      i += 2;
    } else if (char === "'" || char === '"') {
      // JSX attribute quotes have no JavaScript backslash escapes.
      const end = source.indexOf(char, i + 1);
      if (end < 0) return false;
      i = end + 1;
    } else if (/\s/.test(char) || (char === "/" && (next === "/" || next === "*"))) {
      i = skipTrivia(source, i);
    } else if (char === "=" && context.attribute) {
      context.attribute = false;
      i++;
    } else {
      const attribute = nameAt(i);
      // A constrained TSX generic can start just like a tag with attributes.
      if (!attribute || attribute === "extends") return false;
      context.attribute = true;
      i += attribute.length;
    }
    return true;
  }

  // Explicit contexts also bound stack usage for deeply nested untrusted templates.
  const contexts = [codeContext()];
  while (i < source.length) {
    const context = contexts[contexts.length - 1];
    const char = source[i];
    const next = source[i + 1];
    if (context.jsx) {
      if (!readMarkup(context, char, next)) return keepUncertain(i);
      continue;
    }
    if (context.template) {
      if (char === "\\") i += 2;
      else if (char === "`") { i++; contexts.pop(); }
      else if (char === "$" && next === "{") { i += 2; contexts.push(codeContext(true)); }
      else i++;
      continue;
    }
    if (/\s/.test(char)) {
      if (LINE_BREAK.test(char)) context.newline = true;
      i++;
      continue;
    }
    if ((char === "/" && next === "/") || (i === 0 && char === "#" && next === "!")) {
      i += 2;
      while (i < source.length && !LINE_BREAK.test(source[i])) i++;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (LINE_BREAK.test(source[i])) context.newline = true;
        i++;
      }
      i = Math.min(source.length, i + 2);
      continue;
    }
    if (char !== "{") context.body = null;
    const newline = context.newline;
    context.newline = false;
    const start = i;
    if (allowMarkup && char === "<" && (context.regex || newline) && openElement()) {
      // A line break can start a standalone JSX expression or continue a comparison.
      if (!context.regex) return keepUncertain(start);
      context.regex = context.statement = false;
      context.previous = "value";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      if (char === "`") { contexts.push({ template: true, start: i++ }); }
      else if (!quoted(char)) return keepUncertain(start);
      context.regex = context.statement = false;
      context.previous = "value";
      continue;
    }
    if (char === "/" && context.regex) {
      // Contextual keywords can also be identifiers. A TypeScript postfix !
      // ends a value. In either case this slash could divide a real import.
      if (/^(await|yield|of|async|postfix!)$/.test(context.previous) || !regex()) {
        return keepUncertain(start);
      }
      context.regex = context.statement = false;
      context.previous = "value";
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = i++;
      while (/[A-Za-z0-9_$]/.test(source[i] || "")) i++;
      const word = source.slice(start, i);
      if (word === "from" || word === "import" || word === "require") starts.add(start);
      const property = context.previous === ".";
      if (!property && /^(if|while|for|with|switch|catch)$/.test(word)) context.control = true;
      if (!property && word === "function") context.callable = { expression: !context.statement };
      if (!property && (word === "class" || (context.statement && /^(interface|enum|namespace|module)$/.test(word)))) {
        context.classBody = { expression: !context.statement };
      }
      context.statement = !property && (/^(else|do|try|finally|export)$/.test(word)
        || (context.statement && /^(export|default|async|declare|abstract)$/.test(word)));
      context.regex = !property && (prefixWords.has(word) || context.statement);
      context.previous = word;
      continue;
    }
    if (/[0-9]/.test(char)) {
      i++;
      while (/[A-Za-z0-9_.]/.test(source[i] || "")) i++;
      context.regex = context.statement = false;
      context.previous = "value";
      continue;
    }
    const possiblePostfix = char === "!" && !context.regex;
    if (char === "(") {
      context.parens.push({ control: context.control, callable: context.callable });
      context.control = false;
      context.callable = null;
      context.regex = true;
      context.statement = false;
    } else if (char === ")") {
      const header = context.parens.pop();
      context.regex = context.statement = Boolean(header && header.control);
      context.body = header && (header.callable || (header.control ? { expression: false } : null));
    } else if (char === "{") {
      // A statement/function body permits a following regex; object literals and
      // function/arrow/class expressions finish a value, so a following / divides.
      const body = context.classBody || context.body;
      const block = body || context.statement || context.previous === ")";
      context.braces.push({ expression: body ? body.expression : !block || !context.statement });
      context.classBody = context.body = null;
      context.regex = true;
      context.statement = Boolean(block);
    } else if (char === "}") {
      if (context.interpolation && !context.braces.length) { i++; contexts.pop(); continue; }
      const body = context.braces.pop();
      context.regex = context.statement = Boolean(body && !body.expression);
    } else if (char === "=" && next === ">") {
      i++;
      context.body = { expression: true };
      context.regex = true;
      context.statement = false;
    } else if (char === ";") {
      context.regex = context.statement = true;
    } else if (char === "]" || char === "." || (char === "?" && next === ".")) {
      if (char === "?") i++;
      context.regex = context.statement = false;
    } else if ((char === "+" || char === "-") && next === char) {
      i++; // Prefix/postfix ++ and -- preserve whether a value is still expected.
      context.statement = false;
    } else {
      const conditional = char === ":" && context.ternaries > 0;
      if (char === "?") context.ternaries++;
      if (conditional) context.ternaries--;
      context.regex = /[\/[,:=!?&|+\-*%^~<>]/.test(char);
      context.statement = char === ":" && !conditional
        && Boolean(context.braces.length && !context.braces[context.braces.length - 1].expression);
    }
    if (possiblePostfix) context.previous = "postfix!";
    else context.previous = char === "?" && next === "." ? "." : char;
    i++;
  }

  const unclosed = contexts.find(frame => frame.jsx || frame.template);
  return unclosed ? keepUncertain(unclosed.start) : starts;
}

// Decode literal escapes without evaluating project text. Invalid escapes and
// interpolated templates cannot prove that a particular file is missing.
const escapePattern = /\\(?:\r\n|[\r\n\u2028\u2029]|x([\da-fA-F]{2})|u([\da-fA-F]{4})|u\{([\da-fA-F]+)\}|([0-3][0-7]{0,2}|[4-7][0-7]?)|([^xu]))/y;
const simpleEscapes = new Map(Object.entries({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" }));

function readRelativeLiteral(source, opening, call) {
  const quote = source[opening];
  if (quote !== '"' && quote !== "'" && !(call && quote === "`")) return null;
  if (source[opening + 1] !== "." && source[opening + 1] !== "\\") return null;
  let segment = opening + 1;
  let spec = "";
  for (let i = segment; i < source.length; i++) {
    if (source[i] === quote) {
      spec += source.slice(segment, i);
      return spec.startsWith(".") ? { spec, end: i + 1 } : null;
    }
    if (quote === "`" && source.startsWith("${", i)) return null;
    if (quote !== "`" && (source[i] === "\n" || source[i] === "\r")) return null;
    if (source[i] !== "\\" && !(quote === "`" && source[i] === "\r")) continue;
    spec += source.slice(segment, i);
    if (source[i] === "\r") {
      // Template literals normalize CR and CRLF to LF.
      spec += "\n";
      if (source[i + 1] === "\n") i++;
    } else {
      escapePattern.lastIndex = i;
      const escape = escapePattern.exec(source);
      if (!escape) return null;
      const [, hex, unicode, braced, octal, simple] = escape;
      if (hex || unicode || braced) {
        const point = parseInt(hex || unicode || braced, 16);
        if (point > 0x10ffff) return null;
        spec += String.fromCodePoint(point);
      } else if (octal) {
        if (quote === "`" && octal !== "0") return null;
        spec += String.fromCharCode(parseInt(octal, 8));
      } else if (simple) {
        spec += simpleEscapes.get(simple) ?? simple;
      }
      i = escapePattern.lastIndex - 1;
    }
    segment = i + 1;
  }
  return null;
}

// The prefix stops before the literal so a template expression can still contain
// a separate executable import. The step 2 reader decides which words are code.
function* relativeImportLiterals(source, filename) {
  const prefix = /\b(?:from\s*(?=["'])|require\s*(?:\.\s*resolve\s*)?\(|import\s*(?:\(|(?=["'])))/g;
  let starts;
  for (const match of source.matchAll(prefix)) {
    starts ??= executableImportWordStarts(source, filename);
    if (!starts.has(match.index)) continue;
    const call = match[0].endsWith("(");
    const opening = skipTrivia(source, match.index + match[0].length);
    const literal = readRelativeLiteral(source, opening, call);
    if (!literal) continue;
    // Only a complete literal argument names a path. A comma can introduce
    // import attributes or require.resolve options after that argument.
    if (call && ![",", ")"].includes(source[skipTrivia(source, literal.end)])) continue;
    yield { index: match.index, spec: literal.spec, spelling: source.slice(opening + 1, literal.end - 1) };
  }
}

module.exports = { executableImportWordStarts, relativeImportLiterals };
