import test from "node:test";
import assert from "node:assert/strict";

import {
  clean,
  normalize,
  splitList,
  parseBoolean,
  isHttpsUrl,
  isHexColor
} from "../scripts/import-utils.mjs";

test("clean normalizes whitespace", () => {
  assert.equal(clean("  Data   Science  "), "Data Science");
});

test("normalize is case and accent insensitive", () => {
  assert.equal(normalize("  Françoise  "), "francoise");
});

test("splitList removes case-insensitive duplicates", () => {
  assert.deepEqual(
    splitList("AI, Data Science, ai, Health"),
    ["AI", "Data Science", "Health"]
  );
});

test("parseBoolean accepts expected true values", () => {
  assert.equal(parseBoolean("TRUE"), true);
  assert.equal(parseBoolean("yes"), true);
  assert.equal(parseBoolean("FALSE"), false);
});

test("isHttpsUrl rejects insecure and malformed URLs", () => {
  assert.equal(isHttpsUrl("https://brown.edu/example"), true);
  assert.equal(isHttpsUrl("http://brown.edu/example"), false);
  assert.equal(isHttpsUrl("not a URL"), false);
});

test("isHexColor requires six hexadecimal digits", () => {
  assert.equal(isHexColor("#4E3629"), true);
  assert.equal(isHexColor("#fff"), false);
  assert.equal(isHexColor("brown"), false);
});
