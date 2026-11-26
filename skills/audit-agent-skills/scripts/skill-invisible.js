"use strict";

const blackFlag = "\u{1f3f4}";
const groups = [
  // A subdivision flag has two country letters followed by one to three letters or digits.
  ["Unicode tags", /\u{1F3F4}[\u{E0061}-\u{E007A}]{2}[\u{E0061}-\u{E007A}\u{E0030}-\u{E0039}]{1,3}\u{E007F}|[\u{E0000}-\u{E007F}]+/gu],
  ["direction controls", /[\u202A-\u202E\u2066-\u2069]+/gu],
  ["zero-width characters", /[\u200B-\u200D\u2060\uFEFF]{3,}/gu],
  ["variation selectors", /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]{3,}/gu],
];

function hiddenCharacters(text) {
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  let first = Infinity;
  let count = 0;
  const kinds = [];
  for (const [kind, pattern] of groups) {
    const countBefore = count;
    for (const match of body.matchAll(pattern)) {
      if (match[0].startsWith(blackFlag)) continue;
      first = Math.min(first, match.index);
      // A supplementary tag or variation selector occupies two UTF-16 code units.
      for (const _character of match[0]) count++;
    }
    if (count > countBefore) kinds.push(kind);
  }
  if (count === 0) return;
  let line = 1;
  for (let i = 0; i < first; i++) {
    if (body[i] === "\n") line++;
  }
  return { line, count, kind: kinds.join(", ") };
}

module.exports = { hiddenCharacters };
