"use strict";

const path = require("path");

const SCRIPT_LANGUAGES = new Map([
  [".sh", "shell"], [".bash", "shell"], [".zsh", "shell"], [".ps1", "powershell"],
  [".js", "node"], [".cjs", "node"], [".mjs", "node"], [".ts", "node"], [".py", "python"],
]);

function personalPath(file) {
  const ext = path.extname(file.rel).toLowerCase();
  if (ext !== ".md" && file.rel !== "agents/openai.yaml" && !SCRIPT_LANGUAGES.has(ext)) return;
  // Consume a whole web URL before looking for local paths in its segments.
  const pattern = /\b(?:https?|ftp):\/\/[^\s<>"'`\])]+|(?<![\w./~\\-])(?:file:\/\/)?((?:\/Users\/|\/home\/|[a-z]:[\\/]Users[\\/])([\p{L}\p{N}._-]+)|\/root(?=$|[\/\s'"`),;:\]])|\x25USERPROFILE%)/giu;
  for (const match of file.text.matchAll(pattern)) {
    if (!match[1] || /^(?:username|yourname|your-name|your_name)$/i.test(match[2])) continue;
    if (/^\/Users\/Shared$/i.test(match[1])) continue;
    return { text: match[1], line: file.text.slice(0, match.index).split("\n").length };
  }
}

function* commandSources(file) {
  const ext = path.extname(file.rel).toLowerCase();
  const language = SCRIPT_LANGUAGES.get(ext);
  if (language) {
    yield { language, text: file.text, line: 1 };
  } else if (ext === ".md") {
    let fence, block, start;
    const lines = file.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
      if (!fence && delimiter) {
        fence = delimiter[1];
        start = i + 2;
        const info = delimiter[2].trim().split(/\s+/)[0].toLowerCase();
        const language = /^(?:bash|sh|shell|zsh|fish|console)$/.test(info) ? "shell"
          : /^(?:powershell|pwsh|ps1)$/.test(info) ? "powershell" : "";
        block = language && { language, lines: [] };
      } else if (fence && delimiter && delimiter[1].startsWith(fence) && !delimiter[2].trim()) {
        if (block) yield { language: block.language, text: block.lines.join("\n"), line: start };
        fence = null;
      } else if (fence && block) block.lines.push(lines[i]);
    }
    if (fence && block) yield { language: block.language, text: block.lines.join("\n"), line: start };
  }
}

// Keep line breaks and offsets when removing strings and comments. The module marker
// lets the import checks distinguish built-in process functions from unrelated APIs.
function maskedCode(text, language) {
  const ignored = language === "python"
    ? /#[^\n]*|'''[\s\S]*?(?:'''|$)|"""[\s\S]*?(?:"""|$)|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?/g
    : /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?/g;
  return text.replace(ignored, token => {
    if (/^(['"])(?:node:)?child_process\1$/.test(token)) return "@builtin".padEnd(token.length);
    if (/^(['"])recursive\1$/.test(token)) return " recursive ";
    return token.replace(/[^\n]/g, " ");
  });
}

function processBindings(code) {
  const calls = new Set(), modules = new Set(["child_process"]);
  const builtins = /^(?:exec(?:Sync|File(?:Sync)?)?|spawn(?:Sync)?|fork)$/;
  for (const match of code.matchAll(/(?:\bimport\s+\{([^{}]*)\}\s+from\s+@builtin|\{([^{}]*)\}\s*=\s*require\s*\(\s*@builtin\s*\))/g)) {
    for (const entry of (match[1] || match[2] || "").split(",")) {
      const names = entry.trim().split(/\s*(?::|\bas\b)\s*/);
      if (builtins.test(names[0])) calls.add(names[1] || names[0]);
    }
  }
  for (const match of code.matchAll(/(?:\bimport\s+(?:\*\s+as\s+)?([\w$]+)\s+from\s+@builtin|\b([\w$]+)\s*=\s*require\s*\(\s*@builtin\s*\))/g)) {
    modules.add(match[1] || match[2]);
  }
  for (const match of code.matchAll(/\b([\w$]+)(?:\s*\.\s*([\w$]+))?\s*\(/g)) {
    if (match[2] ? modules.has(match[1]) && builtins.test(match[2]) : calls.has(match[1])) return match;
  }
  return /\brequire\s*\(\s*@builtin\s*\)\s*\.\s*(?:exec(?:Sync|File(?:Sync)?)?|spawn(?:Sync)?|fork)\s*\(/.exec(code);
}

function recursiveFileRemoval(code) {
  const parentheses = [];
  let currentRemoval;
  for (const match of code.matchAll(/\bfs\s*\.\s*rm(?:Sync)?\s*\(|\brecursive\s*:\s*true\b|[()]/g)) {
    if (match[0].endsWith("(")) {
      parentheses.push(currentRemoval);
      if (match[0] !== "(") currentRemoval = match;
    } else if (match[0] === ")") currentRemoval = parentheses.pop();
    else if (currentRemoval) return currentRemoval;
  }
}

function inspectProgram(source, record) {
  const code = maskedCode(source.text, source.language);
  function add(rule, match) {
    if (!match) return;
    const evidence = source.text.slice(match.index, match.index + match[0].length);
    record(rule, evidence, source.line + code.slice(0, match.index).split("\n").length - 1);
  }
  if (source.language === "python") {
    add("destructive", /\bshutil\s*\.\s*rmtree\s*\(/.exec(code));
    add("execution", /\b(?:subprocess\s*\.\s*(?:run|Popen|call|check_call|check_output|getoutput|getstatusoutput)|os\s*\.\s*system|eval)\s*\(/.exec(code));
    add("network", /\b(?:requests\s*\.\s*(?:get|post|put|delete|patch|head|options|request)|urllib\s*\.\s*request\s*\.\s*(?:urlopen|urlretrieve))\s*\(/.exec(code));
  } else {
    add("destructive", recursiveFileRemoval(code));
    add("execution", processBindings(code) || /\beval\s*\(/.exec(code));
    add("network", /\b(?:fetch|https?\s*\.\s*(?:get|request))\s*\(/.exec(code));
  }
}

function inspectShell(source, record) {
  // Split commands at unquoted operators. Quoted command names and flags are words.
  const tokens = /\\\r?\n|(?:[^\s;&|()'"\\#]|\\[^\n]|"(?:\\.|[^"\\])*"?|'[^']*'?)+|#[^\n]*|&&|\|\||[;&|()\n]/g;
  let words = [], pipeFromDownload = false, line = source.line, commandLine = line;
  function endCommand(separator) {
    let start = 0;
    while (start < words.length) {
      const word = words[start].value;
      if (word === "sudo") {
        start++;
        while (start < words.length && words[start].value.startsWith("-")) {
          const flag = words[start++].value;
          if (/^-(?:u|g|h|p|C|T)$/.test(flag)) start++;
        }
      } else if (/^(?:if|elif|then|else|do|command|env|\$)$/.test(word) || /^\w+=/.test(word)) start++;
      else break;
    }
    if (start >= words.length) {
      if (separator !== "\n") pipeFromDownload = false;
    } else {
      const name = words[start].value.split(/[\\/]/).pop().toLowerCase();
      const params = words.slice(start + 1);
      const args = params.map(w => w.value);
      const delimiter = args.indexOf("--");
      const options = delimiter < 0 ? args : args.slice(0, delimiter);
      const flags = options.filter(a => /^-[^-]/.test(a)).join("");
      const helpOnly = args.length === 1 && ["--help", "--version", "-V"].includes(args[0]);
      const download = ["curl", "wget", "invoke-webrequest"].includes(name) && !helpOnly;
      const installs = (name === "npm" && /^(?:install|i|ci)$/.test(args.find(a => !a.startsWith("-")))) ||
        (name === "npx" && args.some(a => !a.startsWith("-"))) ||
        (/^pip(?:3(?:\.\d+)?)?$/.test(name) && args.includes("install")) ||
        (/^python(?:3(?:\.\d+)?)?$/.test(name) && args.join(" ").includes("-m pip install"));
      if (download || installs) record("network", words[start].value, commandLine);
      if (pipeFromDownload && /^(?:sh|bash|zsh|dash|ksh|pwsh|powershell)$/.test(name)) record("execution", words[start].value, commandLine);
      if ((name === "rm" && (/[rR]/.test(flags) || options.includes("--recursive")) && (flags.includes("f") || options.includes("--force"))) ||
          (name === "find" && args.includes("-delete")) ||
          (name === "git" && ((args[0] === "reset" && args.includes("--hard")) || (args[0] === "push" && args.includes("--force")))) ||
          (name === "dd" && args.some(a => a.startsWith("if="))) ||
          (name === "remove-item" && params.some(w => /^-recurse$/i.test(w.raw)))) {
        record("destructive", words[start].value, commandLine);
      }
      pipeFromDownload = separator === "|" && download;
    }
    words = [];
  }
  for (const match of source.text.matchAll(tokens)) {
    const token = match[0];
    if (/^(?:&&|\|\||[;&|()\n])$/.test(token)) endCommand(token);
    else if (!token.startsWith("#") && !/^\\\r?\n$/.test(token)) {
      if (!words.length) commandLine = line;
      words.push({ raw: token, value: token.replace(/(['"])(.*?)\1/g, "$2") });
    }
    line += token.split("\n").length - 1;
  }
  endCommand("");
}

function contentSafety(file) {
  const found = {};
  function record(rule, text, line) {
    if (!found[rule]) found[rule] = { text, line };
  }
  for (const source of commandSources(file)) {
    if (source.language === "shell" || source.language === "powershell") inspectShell(source, record);
    else inspectProgram(source, record);
  }
  return found;
}

module.exports = { personalPath, contentSafety };
