"use strict";

const { comparePath, displayPath, defaultRoots } = require("./skill-paths");
const { scalar } = require("./skill-yaml");

function textTokens(value) {
  const stop = new Set(["this", "that", "with", "from", "when", "where", "what", "your", "user", "users", "skill", "skills", "agent", "agents", "into", "using", "asks", "asked", "use"]);
  return new Set(String(value || "").toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)?.filter((x) => !stop.has(x)) || []);
}

function overlapScore(a, b) {
  const aa = textTokens(a), bb = textTokens(b);
  if (aa.size < 3 || bb.size < 3) return 0;
  return sharedWordScore(aa, bb);
}

function sharedWordScore(aa, bb) {
  if (!aa.size || !bb.size) return 0;
  let both = 0;
  for (const token of aa) if (bb.has(token)) both++;
  return both / Math.min(aa.size, bb.size);
}

const EVERYDAY_WORDS = new Set(("a an and are as at be before by can do does for from had has have how if in into is it " +
  "not of on or other our per that the their them then there these they this those to use used uses using was we when " +
  "whenever where which who will with without would you your ask asks asked request requested skill skills user users agent agents").split(" "));

function closestDescriptions(skills) {
  const descriptions = skills.filter(skill => skill.description).map(({ name, description }) => {
    const words = description.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
    return { name, words: new Set(words.filter(word => !EVERYDAY_WORDS.has(word))) };
  }).sort((a, b) => comparePath(a.name, b.name));
  const best = [];
  function order(a, b) {
    return b.score - a.score || comparePath(a.names[0], b.names[0]) || comparePath(a.names[1], b.names[1]);
  }
  for (let i = 0; i < descriptions.length; i++) {
    const a = descriptions[i];
    for (let j = i + 1; j < descriptions.length; j++) {
      const b = descriptions[j];
      if (a.name === b.name) continue;
      const pair = { names: [a.name, b.name], score: sharedWordScore(a.words, b.words) };
      if (best.length === 5 && order(pair, best[4]) >= 0) continue;
      const previous = best.findIndex(item => item.names[0] === a.name && item.names[1] === b.name);
      if (previous >= 0) {
        if (best[previous].score >= pair.score) continue;
        best.splice(previous, 1);
      }
      best.push(pair);
      best.sort(order);
      if (best.length > 5) best.pop();
    }
  }
  return best;
}

function descriptionCharacters(skills, contexts) {
  const agentRoots = new Map(defaultRoots().map(root => [displayPath(root.path), root.id === "claude" ? "claude" : "codex"]));
  if (!contexts.some(context => agentRoots.has(context.report.path))) return;
  const totals = { claude: 0, codex: 0 };
  for (const skill of skills) {
    const length = Array.from(scalar(skill.frontmatter.name) + skill.description).length;
    const seen = new Set();
    for (const source of skill.sources) {
      const agent = agentRoots.get(source.root);
      if (agent && !seen.has(source.path)) {
        totals[agent] += length;
        seen.add(source.path);
      }
    }
  }
  return totals;
}

module.exports = { overlapScore, closestDescriptions, descriptionCharacters };
