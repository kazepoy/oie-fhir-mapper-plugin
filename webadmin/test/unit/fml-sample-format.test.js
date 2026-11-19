// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { formatSample } from "../../src/fml/sample-format.js";

test("formats JSON without changing scalar values or losing false and zero", () => {
  const input = '{"active":false,"quantity":0,"name":"a  b","items":[1,2]}';
  const formatted = formatSample(input, "JSON");
  assert.ok(formatted.includes("\n"));
  assert.deepEqual(JSON.parse(formatted), JSON.parse(input));
  assert.equal(formatSample(input, "FHIR"), formatted);
});

test("leaves invalid JSON and plain text available for testing", () => {
  assert.equal(formatSample('{"broken":', "JSON"), '{"broken":');
  assert.equal(formatSample("a;  b", "RAW"), "a;  b");
});

test("shows HL7 segment separators as lines", () => {
  assert.equal(formatSample("MSH|test\rPID|1\r", "HL7V2"), "MSH|test\nPID|1\n");
});
