// SPDX-License-Identifier: MPL-2.0
// Verifies channel groups/tags, FML previews, deployed manifest routes and negative cases.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  asList,
  assertCleanTestResult,
  assertNormalizedEqual,
  connectorOf,
  createOieClient,
  fmlSteps,
  loadManifest,
  mapperSteps,
  readExample,
  readRepoFile
} from "./oie-client.js";

describe("demo channel manifest, FML previews and deployed examples", () => {
  let client;
  let manifest;

  before(async () => {
    client = await createOieClient();
    manifest = await loadManifest();
  });

  after(() => client?.close());

  test("OIE channel groups and functional tags match the active demo exports", async () => {
    const groupsRes = await client.getJson("/api/channelgroups");
    const tagsRes = await client.getJson("/api/server/channelTags");

    const groups = new Map(asList(groupsRes?.list?.channelGroup).map(g => [g.name, g]));
    const actualTagsByChannel = new Map();
    for (const tag of asList(tagsRes?.set?.channelTag)) {
      for (const id of asList(tag?.channelIds?.string)) {
        if (!actualTagsByChannel.has(id)) actualTagsByChannel.set(id, new Set());
        actualTagsByChannel.get(id).add(tag.name);
      }
    }

    const configuration = await readRepoFile("demo/oie-init/data/configuration.xml");
    const tags = [...configuration.matchAll(/<channelTag>\s*<id>[^<]+<\/id>\s*<name>([^<]+)<\/name>\s*<channelIds>([\s\S]*?)<\/channelIds>/g)];
    for (const entry of manifest.channels) {
      const group = groups.get(entry.group);
      assert.ok(group, `Missing OIE channel group: ${entry.group}`);
      const groupIds = asList(group.channels?.channel).map(c => c.id);
      assert.ok(groupIds.includes(entry.id), `${entry.file} missing from group ${entry.group}`);
      const expectedTags = tags.filter(([, , ids]) => ids.includes(`<string>${entry.id}</string>`))
        .map(([, name]) => name).sort();
      assert.ok(expectedTags.length, `${entry.file}: missing exported tags`);
      assert.deepEqual([...(actualTagsByChannel.get(entry.id) || [])].sort(), expectedTags, entry.file);
    }
  });

  test("FHIR Patient and logical JSON FML previews match their expected outputs", async () => {
    for (const [number, validationPerformed] of [["05", true], ["06", false]]) {
      const entry = manifest.channels.find(channel => channel.file.startsWith(number));
      const ch = await client.channel(entry.id);
      const [step] = fmlSteps(ch.sourceConnector.transformer);
      const input = await readRepoFile(`demo/oie-init/${entry.input}`);
      const expected = await readRepoFile(`demo/oie-init/${entry.input.replace(/input\.json$/, "expected.json")}`);
      const result = await client.postTest("/api/extensions/fhir-fml/test", { step, message: input, inputMode: "prepared", format: "json" });
      assertCleanTestResult(result, entry.file);
      assert.equal(result.validationPerformed, validationPerformed);
      assertNormalizedEqual(result.output, expected, entry.file);
    }
  });

  test("the DevDays IG channel builds a Patient and validates it against the packaged profile", async () => {
    const entry = manifest.channels.find(channel => channel.file.startsWith("11-"));
    const channel = await client.channel(entry.id);
    const [destination] = asList(channel.destinationConnectors.connector);
    const [step] = fmlSteps(destination.transformer);
    const preview = await client.postTest("/api/extensions/fhir-fml/test", {
      step, message: step.sampleMessage, inputMode: "prepared", format: "xml"
    });
    assertCleanTestResult(preview, entry.file);
    assert.equal(preview.validationPerformed, true);
    const patient = JSON.parse(preview.output);
    assert.deepEqual(patient.meta.profile, ["http://devdays-example-ig.com/fhir/StructureDefinition/DevDaysIGtutorial-Patient"]);
    assert.equal(patient.identifier[0].value, "100001");
    assert.equal(patient.gender, "female");
    const response = await client.postChannel(entry.port, entry.route, await readRepoFile(`demo/oie-init/${entry.input}`), "text/plain");
    assert.equal(response.status, 200);
    assertNormalizedEqual(response.text, preview.output);
  });

  test("the R5 Organization route validates business JSON and reports an invalid boolean", async () => {
    const entry = manifest.channels.find(channel => channel.file.startsWith("16-"));
    const expected = await readExample("json/organisation-metier-expected.json");
    const previous = await client.latestMessageId(entry.id);
    const response = await client.postChannel(entry.port, entry.route, await readRepoFile(entry.input));
    assert.equal(response.status, 200);
    assertNormalizedEqual(response.text, expected);
    const message = await client.waitNextMessage(entry.id, previous);
    assertNormalizedEqual(connectorOf(message, 1).encoded?.content, expected);

    const invalid = await readExample("json/organisation-metier-invalide.json");
    const channel = await client.channel(entry.id);
    const [step] = mapperSteps(channel.sourceConnector.transformer);
    const preview = await client.postTest("/api/extensions/fhir-mapper/test", { step, message: invalid, dataType: "JSON" });
    assert.match(JSON.stringify(preview.errors), /Organization\.active/);

    const previousInvalid = await client.latestMessageId(entry.id);
    await client.postChannel(entry.port, entry.route, invalid);
    const failed = connectorOf(await client.waitNextMessage(entry.id, previousInvalid), 0);
    assert.equal(failed.status, "ERROR");
    assert.match(failed.processingErrorContent?.content || "", /Organization\.active/);
  });

  test("external terminology unmatched code falls back cleanly via data-absent-reason", async () => {
    const input = await readExample("json/observation-tx-unmatched.json");
    const expected = await readExample("json/observation-tx-unmatched-expected.json");
    const res = await client.postChannel(10816, "/obs-external-tx", input, "application/json");
    assert.equal(res.status, 200, `Unmatched TX -> HTTP ${res.status}: ${res.text}`);
    assertNormalizedEqual(res.text, expected, "External TX unmatched fallback mismatch");
  });
});
