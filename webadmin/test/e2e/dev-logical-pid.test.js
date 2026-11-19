// SPDX-License-Identifier: MPL-2.0
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { steps } from "../../../tools/channel_mapping.mjs";
import { createOieClient, readRepoFile, fmlSteps, assertCleanTestResult, assertNormalizedEqual } from "./oie-client.js";
import { signIn, openStep } from "./session.js";

const fixture = path => readRepoFile(`demo/oie-init/data/${path}`);
let client, id, expected;
before(async () => {
  client = await createOieClient();
  const [root] = steps(await fixture("channels/04-hl7v2-pid-fr-core-ins.xml"), { includeFml: true });
  id = root.findtext("id");
  expected = await fixture("samples/04-hl7v2-pid-fr-core-ins/patient.json");
});
after(() => client?.close());

test("Logical PID XML and FML produce the expected FR Core INS Patient without OieMessage", async () => {
  const channel = await client.channel(id);
  const [step] = fmlSteps(channel.sourceConnector.transformer);
  assert.equal(step.sourceModel, "fhir");
  const result = await client.postTest("/api/extensions/fhir-fml/test", {
    step, inputMode: "prepared", format: "xml", message: step.sampleMessage
  });
  assertCleanTestResult(result, "Logical PID XML preview");
  assert.equal(result.validationPerformed, true);
  assert.equal(result.model.resourceType, "PID");
  assert.equal(result.model.PID_8.value, "F");
  assert.equal(result.model.node, undefined);
  assertNormalizedEqual(result.output, expected, "Logical PID XML preview");
});

test("Strict Parser and PID preparation execute the logical PID map in the deployed channel", async () => {
  const response = await client.postChannel(10801, "/pid-fr-core-ins", await fixture("samples/04-hl7v2-pid-fr-core-ins/input.er7"), "text/plain");
  assert.equal(response.status, 200);
  assertNormalizedEqual(response.text, expected, "Logical PID HTTP transformation");
});

test("the logical source and prepared sample are usable in Web Admin", async () => {
  const session = await signIn();
  try {
    await openStep(session.page, "04 HL7v2 PID to FR Core INS", "PID to FR Core INS Patient");
    const editor = session.page.locator(".fhir-fml");
    await editor.getByRole("tab", { name: "Test", exact: true }).click();
    await editor.getByRole("button", { name: /Full screen/ }).click();
    assert.equal(await editor.getByRole("combobox", { name: "Sample format" }).inputValue(), "xml");
    const reply = session.page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    const result = await (await reply).json();
    assertCleanTestResult(result, "Logical PID Web Admin");
    assertNormalizedEqual(result.output, expected, "Logical PID Web Admin");
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});
