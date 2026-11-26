"use strict";

const downloadName = String.raw`(?:curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)`;
const shellName = String.raw`(?:sh|bash|zsh|dash|ksh|pwsh|powershell)`;
const interpreter = shellName + "|iex|Invoke-Expression";
const downloadCommand = new RegExp(String.raw`(?<![\w.-])${downloadName}(?=[ \t]+\S)(?![ \t]+(?:--help|--version|-V)[ \t]*$)`, "i");
function decoder(segment) {
  const match = /(?<![\w.-])(base64|xxd)(?=[ \t])/.exec(segment);
  if (!match) return;
  const flag = match[1] === "base64" ? /[ \t](?:-d|-D|--decode)(?=\s|$)/ : /[ \t]-r(?=\s|$)/;
  if (flag.test(segment.slice(match.index + match[0].length))) return match;
}

const downloadSink = pipeSink(interpreter);
const decodeSink = pipeSink(shellName);

function pipeSink(names) {
  const sudo = String.raw`(?:sudo[ \t]+(?:(?:-[ug][ \t]+[^ \t|]+|-[nEH]+|--)[ \t]+)*)?`;
  return new RegExp(String.raw`\|[ \t]*${sudo}(?:${names})(?![\w-]|\.[\w-])`, "iy");
}

// Look only at the command directly to the left of each pipe. Each segment is
// inspected at most once even on a long line with many command names or pipes.
function piped(line, findSource, sink) {
  let start = 0;
  for (const separator of line.matchAll(/\|\||&&|[|;`]|&(?![\w.%-]+=)/g)) {
    if (separator[0] === "|") {
      sink.lastIndex = separator.index;
      if (sink.test(line)) {
        const before = line.slice(start, separator.index);
        const command = findSource(before);
        if (command && directOutput(before, command)) {
          return { index: start + command.index, end: sink.lastIndex };
        }
      }
    }
    start = separator.index + separator[0].length;
  }
}

// An echoed name is an argument. A completed command substitution is also an
// argument of its enclosing command, and redirected stdout does not reach a pipe.
function directOutput(segment, command) {
  const prefix = segment.slice(0, command.index);
  if (/(?:^|\s)(?:echo|printf)(?:[ \t]+-[\w-]+)*[ \t]+$/.test(prefix)) return false;
  const argumentsText = segment.slice(command.index + command[0].length);
  if (/[<$]\([ \t]*$/.test(prefix) && argumentsText.includes(")")) return false;
  return !/(?:^|[ \t])1?>/.test(argumentsText);
}

// Shell substitutions need a closing parenthesis on the same line. Stopping
// at command boundaries also keeps an unrelated subsequent command separate.
const downloadSubstitution = new RegExp(
  String.raw`(?<![\w.-])${shellName}[ \t]+(?:<\([ \t]*|-c[ \t]+["']\$\([ \t]*)${downloadName}[ \t][^()|;\x60]*\)`,
  "i",
);
function shellEval(line) {
  const substitutions = /(?<![\w.-])eval[ \t]+["']?(?:\$\(([^();`]*)\)|`([^();`]*)`)/g;
  for (const match of line.matchAll(substitutions)) {
    const body = match[1] ?? match[2];
    const lastCommand = body.slice(body.lastIndexOf("|") + 1).trimStart();
    if (/^base64[ \t]/.test(lastCommand)) {
      const command = decoder(lastCommand);
      if (command && directOutput(lastCommand, command)) return match;
    }
  }
}

const programEval = /(?<![\w.-])(?:exec\s*\(\s*(?:base64\.b64decode|bytes\.fromhex|codecs\.decode)|eval\s*\(\s*(?:atob|Buffer\.from))\s*\(/;

function firstEvidence(line, pipe, ...matches) {
  let first = pipe;
  for (const match of matches) {
    if (match && (!first || match.index < first.index)) {
      first = { index: match.index, end: match.index + match[0].length };
    }
  }
  return first && line.slice(first.index, first.end);
}

function downloadAndRun(line) {
  return firstEvidence(line, piped(line, segment => downloadCommand.exec(segment), downloadSink), downloadSubstitution.exec(line));
}

function decodeAndRun(line) {
  return firstEvidence(line, piped(line, decoder, decodeSink), shellEval(line), programEval.exec(line));
}

module.exports = { downloadAndRun, decodeAndRun };
