// SPDX-License-Identifier: MPL-2.0
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { steps } from "../../../tools/channel_mapping.mjs";
import { createOieClient, readRepoFile, fmlSteps, asList, connectorOf, assertCleanTestResult, assertNormalizedEqual } from "./oie-client.js";
import { signIn, openStep } from "./session.js";

let client, channel, step, expected;
before(async () => {
  client = await createOieClient();
  const [root] = steps(await readRepoFile("demo/oie-init/data/channels/02-adt-a28-patient-terminology.xml"), { includeFml: true });
  channel = await client.channel(root.findtext("id"));
  step = fmlSteps(asList(channel.destinationConnectors.connector)[1].transformer).find(s => Number(s.sequenceNumber) === 1);
  expected = await readRepoFile("demo/oie-init/data/samples/adt-a28/imported-bundle.json");
});
after(() => client?.close());

test("the first group selects Patient and Bundle despite earlier OieMessage and Organization uses, with two nested imports", async () => {
  assert.ok(step);
  assert.equal(step.sourceModel, "fhir");
  assert.equal(step.variable, "fmlImportedBundle");
  const result = await client.postTest("/api/extensions/fhir-fml/test", { step, inputMode: "prepared", format: "json", message: step.sampleMessage });
  assertCleanTestResult(result, "Nested imports");
  assert.equal(result.validationPerformed, true);
  assert.equal(result.model.resourceType, "Patient", "The unused logical source must not be selected");
  assertNormalizedEqual(result.output, expected);
});

test("the deployed A28 pipeline stores the imported Bundle and its trace in destination 2", async () => {
  const previous = await client.latestMessageId(channel.id);
  const response = await client.postChannel(10805, "/fml-terminology", await readRepoFile("demo/oie-init/data/samples/adt-a28.er7"), "text/plain");
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.text).resourceType, "Patient");
  const destination = connectorOf(await client.waitNextMessage(channel.id, previous), 2);
  assert.equal(destination.status, "SENT");
  const entries = asList(destination.channelMapContent?.content?.entry);
  const value = key => entries.find(e => e.string?.[0] === key)?.string[1];
  assertNormalizedEqual(value("fmlImportedBundle"), expected);
  const trace = JSON.parse(value("FML_TRACE_D2_S1"));
  assert.equal(trace.status, "success");
  assert.equal(trace.fmlSource.resourceType, "Patient");
  assert.equal(trace.output.resourceType, "Bundle");
  assert.equal(trace.validationPerformed, true);
});

test("the imports step opens its prepared Patient sample and executes from Web Admin", async () => {
  const session = await signIn();
  try {
    await openStep(session.page, "02 ADT A28 to Patient - Terminology", "Nested imports and multiple models", "Settings context to Patient");
    const editor = session.page.locator(".fhir-fml");
    await editor.getByRole("tab", { name: "Test", exact: true }).click();
    assert.equal(await editor.getByRole("combobox", { name: "Sample format" }).inputValue(), "json");
    const reply = session.page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    const result = await (await reply).json();
    assertCleanTestResult(result, "Nested imports in Web Admin");
    assertNormalizedEqual(result.output, expected);
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});
