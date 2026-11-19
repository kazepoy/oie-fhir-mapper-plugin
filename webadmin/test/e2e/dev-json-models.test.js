// SPDX-License-Identifier: MPL-2.0
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { steps } from "../../../tools/channel_mapping.mjs";
import { createOieClient, readRepoFile, fmlSteps, assertCleanTestResult, assertNormalizedEqual } from "./oie-client.js";
import { signIn, openStep } from "./session.js";

const cases = [
  { file: "05-fhir-patient-normalization.xml", channel: "05 FHIR Patient - Normalize Identity", step: "Normalize Patient identity", dir: "05-fhir-patient-normalization",
    port: 10802, route: "/fhir-patient", model: "fhir", validation: true },
  { file: "06-json-order-to-dispatch.xml", channel: "06 JSON Order to Dispatch", step: "Order to dispatch document", dir: "06-json-order-to-dispatch",
    port: 10803, route: "/commande-json", model: "fhir", validation: false }
];
const fixture = path => readRepoFile(`demo/oie-init/data/${path}`);
let client;
before(async () => { client = await createOieClient(); });
after(() => client?.close());

for (const spec of cases) {
  test(`${spec.channel}: source model, preview and HTTP result match the expected JSON`, async () => {
    const [root] = steps(await fixture(`channels/${spec.file}`), { includeFml: true });
    const channel = await client.channel(root.findtext("id"));
    assert.equal(channel.name, spec.channel);
    const [step] = fmlSteps(channel.sourceConnector.transformer);
    assert.equal(step.sourceModel, spec.model);
    const input = await fixture(`samples/${spec.dir}/input.json`);
    const expected = await fixture(`samples/${spec.dir}/expected.json`);
    const result = await client.postTest("/api/extensions/fhir-fml/test", { step, inputMode: "prepared", format: "json", message: input });
    assertCleanTestResult(result, spec.channel);
    assert.equal(result.validationPerformed, spec.validation);
    assert.equal(result.model.node, undefined);
    assertNormalizedEqual(result.output, expected, spec.channel);
    if (!spec.validation) {
      assert.equal(JSON.parse(result.output).resourceType, undefined);
      assert.deepEqual(result.model, JSON.parse(input));
      const standard = await client.postTest("/api/extensions/fhir-fml/test", { step, inputMode: "prepared", format: "json",
        message: JSON.stringify({ ...JSON.parse(input), urgent: false }) });
      assertCleanTestResult(standard, "Non-urgent order");
      assert.equal(JSON.parse(standard.output).priorite, "standard");
    }
    const response = await client.postChannel(spec.port, spec.route, input);
    assert.equal(response.status, 200);
    assertNormalizedEqual(response.text, expected, `${spec.channel} HTTP`);
  });

  test(`${spec.channel}: embedded JSON sample runs from Web Admin`, async () => {
    const session = await signIn();
    try {
      await openStep(session.page, spec.channel, spec.step);
      const editor = session.page.locator(".fhir-fml");
      await editor.getByRole("tab", { name: "Test", exact: true }).click();
      await editor.getByRole("button", { name: /Full screen/ }).click();
      assert.equal(await editor.getByRole("combobox", { name: "Sample format" }).inputValue(), "json");
      await editor.getByRole("button", { name: "How is the sample interpreted?" }).click();
      const help = session.page.getByRole("dialog", { name: "How is the sample interpreted?" });
      await help.getByText("The source StructureDefinition is resolved from the FML map. XML and JSON are read directly, without OieMessage.").waitFor();
      await editor.getByRole("tab", { name: "Sample", exact: true }).click();
      await help.waitFor({ state: "detached" });
      const reply = session.page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
      await editor.getByRole("button", { name: "Run test", exact: true }).click();
      const result = await (await reply).json();
      assertCleanTestResult(result, spec.channel);
      assertNormalizedEqual(result.output, await fixture(`samples/${spec.dir}/expected.json`), spec.channel);
      assert.deepEqual(session.pluginErrors(), []);
    } finally { await session.close(); }
  });
}
