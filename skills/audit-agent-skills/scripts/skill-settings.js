"use strict";

// A final sentence period is punctuation. A suffix or another path component
// belongs to the filename and must not turn an unrelated file into a finding.
const homePrefix = String.raw`(?<![\w./\\~-])(?:~|\$HOME|\$\{HOME\}|\x25USERPROFILE%)[/\\]`;
const nameEnd = /(?=\.?(?:$|[\s'"\x60<>()\[\]{}|,;:!?&]))/.source;
const sshFile = /\.ssh[/\\]([^\s'"\x60<>()[\]{}|,;:!?&/\\]+)/.source;
const otherStores = String.raw`(?:\.aws[/\\]credentials|\.(?:netrc|npmrc|git-credentials|pypirc)|\.docker[/\\]config\.json|\.kube[/\\]config|\.config[/\\]gh[/\\]hosts\.yml|\.claude[/\\]\.credentials\.json|\.codex[/\\]auth\.json|\.(?:clawdbot|openclaw)[/\\]\.env)`;
const store = new RegExp(homePrefix + "(?:" + sshFile + "|" + otherStores + ")" + nameEnd, "gi");
const loginCommand = /(?<![\w.-])(?:gh\s+auth\s+token|security\s+find-(?:generic|internet)-password)(?![\w-])/i;
const recipient = /(?<!\|)\|\s*(?:curl|wget|nc|ncat)(?![\w.-])/gi;
// Only inspect the sender at a pipe with a matching recipient. Each backwards
// match stops at the preceding pipe, including on very long lines of prose.
const sender = /(?<=((?<![\w.-])(?:env(?:\s+(?:-0|--null))?|printenv(?:\s+(?:-0|--null|[A-Za-z_]\w*))*)\s*))/iy;

function credentialAccess(line) {
  const command = loginCommand.exec(line);
  let firstIndex = command?.index ?? Infinity;
  let firstText = command?.[0];
  for (const pipe of line.matchAll(recipient)) {
    sender.lastIndex = pipe.index;
    const source = sender.exec(line);
    if (!source) continue;
    const start = pipe.index - source[1].length;
    if (start < firstIndex) {
      firstIndex = start;
      firstText = source[1] + pipe[0];
    }
    break;
  }
  for (const match of line.matchAll(store)) {
    if (firstIndex < match.index) break;
    if (!match[1]) return match[0];
    const name = match[1].replace(/\.$/, "");
    if (!/\.pub$/i.test(name) && (/^id_.+/i.test(name) || /\.pem$/i.test(name))) {
      return match[0].replace(/\.$/, "");
    }
  }
  return firstText;
}

const safeguardSwitch = new RegExp(/(?<![\w./=-])--(?:allow-dangerously-skip-permissions|dangerously-skip-permissions|dangerously-bypass-approvals-and-sandbox|yolo)/.source + nameEnd);
const configChange = new RegExp(/(?<![\w.-])(?:NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*(?:"0"|'0'|0)|GIT_SSL_NO_VERIFY\s*=\s*(?:"(?:true|1)"|'(?:true|1)'|true|1)|http\.sslVerify(?:\s*=\s*|\s+)false|spctl\s+--master-disable)/.source + nameEnd);
const powerShellPolicy = new RegExp(/(?<![\w.-])Set-ExecutionPolicy\s+(?:Bypass|Unrestricted)/.source + nameEnd, "i");
const quarantine = new RegExp(/(?<![\w.-])xattr\s+((?:-[a-zA-Z]+\s+)+)com\.apple\.quarantine/.source + nameEnd, "g");

const transfer = /(?<![\w.-])(?:curl|wget)(?![\w.-])/g;
const argument = /\s+|[;&|\x60()]|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|https?:\/\/[^\s'";&|\x60()<>]+(?:&[\w.%~-]+=[^\s'";&|\x60()<>]*)*|[^\s'";&|\x60()]+/gy;
// Short curl switches before k must take no value. A k inside the filename
// attached to an output switch, for example, is part of that filename.
const insecureCurlGroup = /^-[sSfLIivgGqOjR46]*k[a-zA-Z0-9]*$/;
const curlValueOption = /^-[sSfLIivgGqOjR46]*[AbcCdDeEFHKmoPQrTtuUwXxyYz]$/;

function insecureTransfer(line, before) {
  transfer.lastIndex = 0;
  let command;
  while ((command = transfer.exec(line)) && command.index < before) {
    let takesValue = false;
    argument.lastIndex = transfer.lastIndex;
    let token;
    while ((token = argument.exec(line))) {
      const raw = token[0];
      if (/^\s/.test(raw)) continue;
      if (/^[;&|\x60()]$/.test(raw)) break;
      if (takesValue) { takesValue = false; continue; }
      const word = raw.replace(/^(['"])(.*)\1$/, "$2").replace(/[.,:!?]+$/, "");
      if (word === "--") break;
      if (word === "curl" || word === "wget") {
        // The rest of a prose example may name a second command.
        transfer.lastIndex = token.index;
        break;
      }
      if (word === "-k" || word === "--insecure" || word === "--no-check-certificate" ||
          (command[0] === "curl" && insecureCurlGroup.test(word))) {
        return line.slice(command.index, token.index + raw.length);
      }
      takesValue = command[0] === "curl" && curlValueOption.test(word);
      transfer.lastIndex = argument.lastIndex;
    }
  }
}

function safeguardOff(line) {
  let first;
  for (const match of [safeguardSwitch.exec(line), configChange.exec(line), powerShellPolicy.exec(line)]) {
    if (match && (!first || match.index < first.index)) first = match;
  }
  for (const match of line.matchAll(quarantine)) {
    if (match[1].includes("d") && (!first || match.index < first.index)) {
      first = match;
      break;
    }
  }
  return insecureTransfer(line, first?.index ?? Infinity) ?? first?.[0];
}

module.exports = { credentialAccess, safeguardOff };
