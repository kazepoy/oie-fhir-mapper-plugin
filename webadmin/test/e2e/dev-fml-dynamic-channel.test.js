// SPDX-License-Identifier: MPL-2.0
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createOieClient, readRepoFile, asList, connectorOf, fmlSteps, assertCleanTestResult, assertNormalizedEqual } from "./oie-client.js";

const id = "27b2a850-f3d4-46bb-b8ba-37f477c78818";
const samples = "demo/oie-init/data/samples/18-adt-patient-dynamic-fml/";
let client, channel, step;
before(async () => {
  client = await createOieClient();
  channel = await client.channel(id);
  const destinations = asList(channel.destinationConnectors.connector);
  assert.equal(destinations.length, 1);
  [step] = fmlSteps(destinations[0].transformer);
  assert.equal(step.mapUrl, "${fmlMapUrl}");
  assert.equal(step.sourceModelUrl, "${fmlSourceModelUrl}");
});
after(() => client?.close());

for (const event of ["a28", "a31", "a08"]) {
  test(`ADT ${event.toUpperCase()} selects its map and SD in the same destination and records both URLs`, async () => {
    const expected = await readRepoFile(samples + `patient-${event}.json`);
    const variables = JSON.parse(await readRepoFile(samples + `variables-${event}.json`));
    const preview = await client.postTest("/api/extensions/fhir-fml/test", {
      step, inputMode: "prepared", format: "xml", message: await readRepoFile(samples + `pid-${event}.xml`), variables
    });
    assertCleanTestResult(preview, event + " preview");
    assertNormalizedEqual(preview.output, expected);
    assert.deepEqual(preview.resolvedReferences, { mapUrl: variables.fmlMapUrl, sourceModelUrl: variables.fmlSourceModelUrl });
    const previous = await client.latestMessageId(id);
    const response = await client.postChannel(10818, "/adt-dynamic-fml", await readRepoFile(samples + `adt-${event}.er7`), "text/plain");
    assert.equal(response.status, 200);
    assertNormalizedEqual(response.text, expected);
    const destination = connectorOf(await client.waitNextMessage(id, previous), 1);
    assert.equal(destination.status, "SENT");
    const entries = asList(destination.channelMapContent?.content?.entry);
    const value = key => entries.find(entry => entry.string?.[0] === key)?.string[1];
    assert.equal(value("fmlMapUrl"), variables.fmlMapUrl);
    assert.equal(value("fmlSourceModelUrl"), variables.fmlSourceModelUrl);
    const trace = JSON.parse(value("FML_TRACE_D1_S1"));
    assert.equal(trace.status, "success");
    assert.equal(trace.mapReference, variables.fmlMapUrl);
    assert.equal(trace.sourceModelUrl, variables.fmlSourceModelUrl);
    assert.equal(trace.validationPerformed, true);
    assertNormalizedEqual(trace.output, expected);
  });
}

test("the source filter rejects unsupported ADT events before the dynamic destination", async () => {
  const message = (await readRepoFile(samples + "adt-a08.er7")).replace("ADT^A08^ADT_A01", "ADT^A01^ADT_A01").replace("EVN|A08|", "EVN|A01|");
  const previous = await client.latestMessageId(id);
  await client.postChannel(10818, "/adt-dynamic-fml", message, "text/plain");
  const processed = await client.waitNextMessage(id, previous);
  assert.equal(connectorOf(processed, 0).status, "FILTERED");
});

test("the channel's saved A28 variables are ready to run with the variable section collapsed", async () => {
  const { signIn, openStep } = await import("./session.js");
  const session = await signIn();
  try {
    await openStep(session.page, "18 ADT to Patient - Dynamic FML", "Patient using the selected map and model", "Dynamic ADT to Patient");
    const editor = session.page.locator(".fhir-fml");
    await editor.getByRole("tab", { name: "Test", exact: true }).click();
    const variables = JSON.parse(await readRepoFile(samples + "variables-a28.json"));
    assert.equal(await editor.locator(".fml-test-variables").evaluate(el => el.open), false);
    for (const [name, value] of Object.entries(variables))
      assert.equal(await editor.locator(`input[aria-label="${name}"]`).inputValue(), value);
    const reply = session.page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    const result = await (await reply).json();
    assertCleanTestResult(result, "Prefilled demo");
    assertNormalizedEqual(result.output, await readRepoFile(samples + "patient-a28.json"));
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});
