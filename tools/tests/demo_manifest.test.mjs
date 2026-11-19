// Cohérence hors ligne entre les exports XML de demo/oie-init, les groupes et tools/load.
// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findPathText, FML_TYPE, steps } from "../channel_mapping.mjs";
import { VARIANTES, variante } from "../load/oru_variantes.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXAMPLES_DIR = join(ROOT, "examples");
const CHANNELS_DIR = join(ROOT, "demo/oie-init/data/channels");
const GROUPS_DIR = join(ROOT, "demo/oie-init/data/groups");

function findAllBlocks(xml, tagName) {
  const escaped = tagName.replaceAll(".", "\\.");
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1]);
}

test("demo exports have unique ports, inbound templates, and valid step material", () => {
  const files = readdirSync(CHANNELS_DIR).filter((f) => f.endsWith(".xml")).sort();
  assert.ok(files.length >= 11);

  const ports = new Set();
  for (const file of files) {
    const xml = readFileSync(join(CHANNELS_DIR, file), "utf8");
    const [root, allEntries] = steps(xml, { includeFml: true });
    assert.ok(root.findtext("sourceConnector/transformer/inboundTemplate"), file);

    const port = findPathText(xml, "sourceConnector/properties/listenerConnectorProperties/port");
    if (port) {
      assert.ok(!ports.has(port), `Duplicate port ${port} in ${file}`);
      ports.add(port);
    }

    const mappers = allEntries.filter(([, , , s]) => s.__type !== FML_TYPE).map(([, , , s]) => s);
    if (mappers.length > 0) {
      const samples = mappers.flatMap((s) => JSON.parse(s.samples || "[]"));
      assert.ok(samples.length > 0, `${file}: expected saved samples`);
      assert.ok(samples.every((s) => s.message && s.expected), `${file}: sample missing message/expected`);
    }
  }
});

test("native groups cover all demo channels without duplicates", () => {
  const files = readdirSync(CHANNELS_DIR).filter((f) => f.endsWith(".xml")).sort();
  const allChannelIds = new Set(files.map((f) => findPathText(readFileSync(join(CHANNELS_DIR, f), "utf8"), "id")));

  const groupFiles = readdirSync(GROUPS_DIR).filter((f) => f.endsWith(".xml")).sort();
  assert.ok(groupFiles.length > 0);
  const members = new Set();
  for (const groupFile of groupFiles) {
    const groupXml = readFileSync(join(GROUPS_DIR, groupFile), "utf8");
    const groupBlock = findAllBlocks(groupXml, "channelGroup")[0];
    assert.ok(groupBlock, `Missing channelGroup in ${groupFile}`);
    const channelsContainer = findAllBlocks(groupBlock, "channels")[0] || "";
    for (const ch of findAllBlocks(channelsContainer, "channel")) {
      const id = findPathText(ch, "id");
      assert.ok(!members.has(id), `Channel ${id} belongs to multiple groups`);
      members.add(id);
    }
  }
  assert.deepEqual(members, allChannelIds);
});

test("load variant generator produces valid 7-step ORU channel variants", () => {
  assert.equal(VARIANTES.length, 5);
  for (const [nom, port, validation, trace, dtValidation] of VARIANTES) {
    const { xml } = variante(nom, port, validation, trace, dtValidation);
    const [root, entries] = steps(xml);
    assert.equal(Number(root.findtext("sourceConnector/properties/listenerConnectorProperties/port")), port);
    assert.equal(entries.length, 7);
    for (const [, , , step] of entries) {
      assert.equal(step.validateOutput, String(validation));
      assert.equal(step.traceMessages, String(trace));
    }
  }
});

test("load scripts reference existing example messages and variants", () => {
  const runSh = readFileSync(join(ROOT, "tools/load/run.sh"), "utf8");
  assert.ok(runSh.includes('"$ROOT/examples:/examples:ro"'));
  assert.ok(existsSync(join(ROOT, "tools/load/charge.js")));
  assert.ok(existsSync(join(ROOT, "tools/load/oru.js")));

  const oruSrc = readFileSync(join(ROOT, "tools/load/oru.js"), "utf8");
  const oruExampleMatch = oruSrc.match(/open\('\/examples\/([^']+)'\)/);
  assert.ok(oruExampleMatch, "oru.js must open an /examples/... file");
  assert.ok(existsSync(join(EXAMPLES_DIR, oruExampleMatch[1])), `oru.js: missing example ${oruExampleMatch[1]}`);

  const oruVariants = [
    ...oruSrc.matchAll(/\{\s*nom:\s*'([^']+)',\s*port:\s*(\d+)/g),
  ].map(([, nom, port]) => [nom, Number(port)]);
  assert.deepEqual(
    oruVariants,
    VARIANTES.map(([nom, port]) => [nom, port])
  );
});
