"use strict";

function excerpt(text) {
  // Format controls in a quoted command must also be visible when it shares a line with hidden text.
  // Each 80-character end fits in 160 UTF-16 units. Bound escaping even for a megabyte-long match.
  const sample = text.length > 320 ? text.slice(0, 160) + "…" + text.slice(-160) : text;
  const visible = sample.replace(/[\u200b-\u200d\u202a-\u202e\u2060\u2066-\u2069\ufeff\ufe00-\ufe0f\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu,
    ch => "\\u{" + ch.codePointAt(0).toString(16) + "}");
  const chars = Array.from(visible);
  return chars.length <= 80 ? visible : chars.slice(0, 52).join("") + "…" + chars.slice(-27).join("");
}

module.exports = { excerpt };
