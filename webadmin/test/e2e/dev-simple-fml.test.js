// SPDX-License-Identifier: MPL-2.0
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { steps } from "../../../tools/channel_mapping.mjs";
import { createOieClient, readRepoFile, fmlSteps, connectorOf, assertCleanTestResult, assertNormalizedEqual } from "./oie-client.js";
import { signIn, openStep } from "./session.js";

const fixture = path => readRepoFile(`demo/oie-init/data/${path}`);
let client, id, expected;
before(async () => {
  client = await createOieClient();
  const [root] = steps(await fixture("channels/01-adt-a28-patient-inline-fml.xml"), { includeFml: true });
  id = root.findtext("id");
  expected = await fixture("samples/patient.json");
});
after(() => client?.close());

test("the source converts ER7 to native XML and the destination runs only an inline FML", async () => {
  const channel = await client.channel(id);
  const source = channel.sourceConnector.transformer;
  assert.equal(channel.name, "01 ADT A28 to Patient - Inline FML");
  assert.equal(source.inboundDataType, "HL7V2");
  assert.equal(source.outboundDataType, "XML");
  assert.equal(source.inboundProperties.serializationProperties.useStrictParser, false);
  assert.equal(JSON.stringify(source.elements || {}).includes("JavaScriptStep"), false);
  assert.equal(fmlSteps(source).length, 0);
  const destination = channel.destinationConnectors.connector;
  assert.equal(Array.isArray(destination), false);
  assert.equal(destination.transformer.inboundDataType, "XML");
  assert.equal(destination.transformer.outboundDataType, "RAW");
  assert.equal(JSON.stringify(destination.transformer.elements || {}).includes("JavaScriptStep"), false);
  const [step] = fmlSteps(destination.transformer);
  assert.ok(step.mapSource.includes("group AdtA28ToPatient"));
  assert.equal(step.mapUrl || "", "");
  const result = await client.postTest("/api/extensions/fhir-fml/test", {
    step, inputMode: "prepared", format: "xml", message: step.sampleMessage
  });
  assertCleanTestResult(result, "Simple FML preview");
  assert.equal(result.validationPerformed, true);
  assertNormalizedEqual(result.output, expected, "Simple FML preview");
  const previous = await client.latestMessageId(id);
  const response = await client.postChannel(10804, "/simple-fml", await fixture("samples/adt-a28.er7"), "text/plain");
  assert.equal(response.status, 200);
  assertNormalizedEqual(response.text, expected, "Simple FML HTTP output");
  const message = await client.waitNextMessage(id, previous);
  const encodedXml = connectorOf(message, 0).encoded.content;
  assert.match(encodedXml, /<HL7Message>/);
  assert.match(encodedXml, /<MSH\.9\.2>A28<\/MSH\.9\.2>/);
  assert.doesNotMatch(encodedXml, /<(ORC|OBR|OBX)>/);
  assert.match(encodedXml, /<PID\.5\.1>MARTIN<\/PID\.5\.1>/);
  const output = connectorOf(message, 1);
  assert.equal(output.raw.content, encodedXml);
  assert.equal(output.status, "SENT");
  assertNormalizedEqual(output.encoded.content, expected, "Simple FML destination output");
});

test("the destination opens its XML sample and runs from Web Admin", async () => {
  const session = await signIn();
  try {
    await openStep(session.page, "01 ADT A28 to Patient - Inline FML", "PID XML to Patient", "XML to Patient");
    const editor = session.page.locator(".fhir-fml");
    await editor.getByRole("tab", { name: "Test", exact: true }).click();
    await editor.getByRole("button", { name: /Full screen/ }).click();
    assert.equal(await editor.getByRole("combobox", { name: "Sample format" }).inputValue(), "channel");
    assert.equal(await editor.locator("#fml-sample-format option:checked").textContent(), "Destination 1 input · XML");
    const readSample = () => session.page.evaluate(() => window.monaco.editor.getEditors()
      .find(e => e.getDomNode()?.closest("#fml-test-panel-sample"))?.getValue());
    const original = await readSample();
    const declarations = (original.match(/<\?xml\b/g) || []).length;
    await editor.getByRole("checkbox", { name: "Format", exact: true }).check();
    await session.page.waitForFunction(() => window.monaco.editor.getEditors()
      .find(e => e.getDomNode()?.closest("#fml-test-panel-sample"))?.getValue().split("\n").length > 10);
    const formatted = await readSample();
    assert.equal((formatted.match(/<\?xml\b/g) || []).length, declarations);
    assert.equal(await session.page.evaluate(xml => new DOMParser().parseFromString(xml, "application/xml")
      .querySelector("parsererror") === null, formatted), true);
    await editor.getByRole("button", { name: "How is the sample interpreted?" }).click();
    const help = session.page.getByRole("dialog", { name: "How is the sample interpreted?" });
    await help.getByText("The plugin builds OieMessage nodes from the XML, JSON or text. FML source shows this instance as JSON.").waitFor();
    const box = await help.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= session.page.viewportSize().width);
    await session.page.keyboard.press("Escape");
    await help.waitFor({ state: "detached" });
    const reply = session.page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    const response = await reply;
    const payload = response.request().postDataJSON();
    assert.equal(payload.inputMode, "raw");
    assert.equal(payload.dataType, "XML");
    assert.equal(payload.message, original, "Display formatting must not alter the test payload");
    const result = await response.json();
    assertCleanTestResult(result, "Simple FML Web Admin");
    assertNormalizedEqual(result.output, expected, "Simple FML Web Admin");
    await editor.getByRole("tab", { name: "Sample", exact: true }).click();
    await editor.getByRole("checkbox", { name: "Format", exact: true }).uncheck();
    assert.equal(await readSample(), original);
    for (let attempt = 0; attempt < 3; attempt++) {
      await editor.getByRole("checkbox", { name: "Format", exact: true }).check();
      assert.equal(((await readSample()).match(/<\?xml\b/g) || []).length, declarations);
      await editor.getByRole("checkbox", { name: "Format", exact: true }).uncheck();
      assert.equal(await readSample(), original);
    }
    assert.equal(await editor.getByText("Run again to update the result and validation.", { exact: true }).isVisible(), false);
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});
