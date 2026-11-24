// SPDX-License-Identifier: MPL-2.0
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { steps } from "../../../tools/channel_mapping.mjs";
import { REPO_ROOT, createOieClient, readRepoFile, assertCleanTestResult, assertNormalizedEqual, fmlSteps, connectorOf } from "./oie-client.js";
import { openStep as openChannelStep, signIn } from "./session.js";

const destinationsOf = channel => channel.destinationConnectors.connector;
const standardOf = channel => destinationsOf(channel).find(d => d.metaDataId === 1).transformer;
const openStep = (page, channel, name) => openChannelStep(page, channel, name,
  name === "PID to Patient" ? "Standard HL7v2 to Patient" : name === "Strict PID to Patient" ? "Strict HL7v2 to Patient" : name);
const normalizeSample = text => text.replace(/\r\n?|\n/g, "\n").trim();
const fixture = path => readRepoFile(`demo/oie-init/data/${path}`);
const waitForFmlLayout = page => page.waitForFunction(() => window.monaco.editor.getEditors()
  .filter(e => e.getDomNode()?.closest(".fml-test-panel:not([hidden])"))
  .every(e => Math.abs(e.getLayoutInfo().height - e.getDomNode().closest(".fm-code-box").clientHeight) < 6
    && e.getVisibleRanges().some(range => range.endLineNumber > 1)));


describe("development ORU to Patient with standard parser and inline FML", () => {
  let client, id, input, expected;
  before(async () => {
    client = await createOieClient();
    const [root] = steps(await fixture("channels/03-hl7v2-patient-oiemessage.xml"), { includeFml: true });
    id = root.findtext("id");
    input = await fixture("samples/oru-r01.er7");
    expected = await fixture("samples/patient.json");
  });
  after(() => client?.close());

  test("the imported step previews and validates the expected Patient without an IG", async () => {
    const channel = await client.channel(id);
    const transformer = standardOf(channel);
    assert.equal(channel.sourceConnector.transformer.inboundDataType, "RAW");
    assert.deepEqual(fmlSteps(channel.sourceConnector.transformer), []);
    assert.equal(destinationsOf(channel).length, 5);
    assert.ok(destinationsOf(channel).every(d => d.waitForPrevious === false));
    assert.equal(transformer.inboundDataType, "HL7V2");
    assert.equal(transformer.inboundProperties.serializationProperties.useStrictParser, false);
    const selected = fmlSteps(transformer);
    assert.equal(selected.length, 1);
    assert.ok(selected[0].mapSource.includes("OruPidToPatient"));
    assert.equal(selected[0].context || "", "");
    assert.equal(selected[0].profiles || "", "");
    const result = await client.postTest("/api/extensions/fhir-fml/test", { step: selected[0], message: input, dataType: "HL7V2" });
    assertCleanTestResult(result, "ORU preview");
    assert.equal(result.validationPerformed, true);
    assertNormalizedEqual(result.output, expected, "ORU preview output");
  });

  test("the XML, JSON and text examples produce their expected Patients", async () => {
    const channel = await client.channel(id);
    const selected = destinationsOf(channel).filter(d => d.metaDataId >= 3).map(d => fmlSteps(d.transformer)[0]);
    for (const [index, format, sample, output] of [[0, "xml", "prepared-patient.xml", "patient.json"],
      [1, "json", "prepared-patient.json", "patient.json"], [2, "raw", "prepared-identifier.txt", "patient-identifier.json"]]) {
      const result = await client.postTest("/api/extensions/fhir-fml/test", { step: selected[index], inputMode: "prepared",
        format, message: await fixture(`samples/${sample}`) });
      assertCleanTestResult(result, sample);
      assert.equal(result.validationPerformed, true);
      assertNormalizedEqual(result.output, await fixture(`samples/${output}`), sample);
    }
  });

  test("the strict destination previews the original ORU using its own parser options", async () => {
    const channel = await client.channel(id);
    const transformer = destinationsOf(channel).find(d => d.metaDataId === 2).transformer;
    assert.equal(transformer.inboundDataType, "HL7V2");
    assert.equal(transformer.inboundProperties.serializationProperties.useStrictParser, true);
    const [step] = fmlSteps(transformer);
    assert.equal(normalizeSample(step.sampleMessage), normalizeSample(input));
    const result = await client.postTest("/api/extensions/fhir-fml/test", { step, inputMode: "raw", message: step.sampleMessage,
      dataType: transformer.inboundDataType, dataTypeProperties: transformer.inboundProperties });
    assertCleanTestResult(result, "Strict destination preview");
    assert.equal(result.model.name, "ORU_R01");
    assertNormalizedEqual(result.output, expected, "Strict destination preview");
  });

  test("Summary parser options change the source, while prepared input bypasses them", async () => {
    const channel = await client.channel(id);
    const [selected] = fmlSteps(standardOf(channel));
    const step = { ...selected, validateOutput: false };
    const standard = await client.postTest("/api/extensions/fhir-fml/test", { step, message: input, inputMode: "raw",
      dataType: "HL7V2", dataTypeProperties: standardOf(channel).inboundProperties });
    assertCleanTestResult(standard, "standard parser");
    assert.equal(standard.model.name, "HL7Message");
    const strict = await client.postTest("/api/extensions/fhir-fml/test", { step, message: input, inputMode: "raw", dataType: "HL7V2",
      dataTypeProperties: { serializationProperties: { ...standardOf(channel).inboundProperties.serializationProperties,
        useStrictParser: true, useStrictValidation: false } } });
    assertCleanTestResult(strict, "strict parser");
    assert.equal(strict.model.name, "ORU_R01");
    const csv = await client.postTest("/api/extensions/fhir-fml/test", { step, inputMode: "raw", dataType: "DELIMITED",
      message: '100001;"MARTIN;CLAIRE";"A""B"', dataTypeProperties: { serializationProperties: {
        columnDelimiter: ";", recordDelimiter: "\n", quoteToken: '"', escapeWithDoubleQuote: true, columnNames: ["id", "name", "note"] } } });
    assertCleanTestResult(csv, "custom CSV parser");
    const csvSource = JSON.stringify(csv.model);
    assert.ok(csvSource.includes("MARTIN;CLAIRE"));
    assert.ok(csvSource.includes('A\\"B'));
    for (const [format, message, expectedValue] of [["xml", "<prepared><id>100001</id></prepared>", "100001"],
      ["json", '{"id":"prepared-json"}', "prepared-json"], ["raw", "MSH|raw-text", "MSH|raw-text"]]) {
      const result = await client.postTest("/api/extensions/fhir-fml/test", { step, inputMode: "prepared", format, message,
        dataType: "HL7V2", dataTypeProperties: { serializationProperties: { useStrictParser: true } } });
      assertCleanTestResult(result, `prepared ${format}`);
      assert.ok(JSON.stringify(result.model).includes(expectedValue));
    }
  });

  test("the preview accepts null optional fields sent by Web Admin", async () => {
    const channel = await client.channel(id);
    const [selected] = fmlSteps(standardOf(channel));
    const step = { ...selected, context: null, profiles: null, mapUrl: null, variable: null,
      contextVariables: null, sourceModelUrl: null, fhirVersion: null };
    const result = await client.postTest("/api/extensions/fhir-fml/test", { step, message: input, dataType: "HL7V2" });
    assertCleanTestResult(result, "ORU preview with JSON null");
    assert.equal(result.validationPerformed, true);
    assertNormalizedEqual(result.output, expected, "ORU preview with JSON null output");
  });

  test("the source forwards the ORU unchanged and all five destinations transform independently", async () => {
    const previous = await client.latestMessageId(id);
    const response = await client.postChannel(10800, "/oru-patient", input, "text/plain");
    assert.equal(response.status, 200);
    assertNormalizedEqual(response.text, expected, "Deployed ORU output");
    const message = await client.waitNextMessage(id, previous);
    const source = connectorOf(message, 0);
    assert.equal(source.encoded.content, input);
    for (const metaDataId of [1, 2, 3, 4, 5]) {
      const destination = connectorOf(message, metaDataId);
      assert.equal(destination.status, "SENT", `Destination ${metaDataId}`);
      assert.equal(destination.raw.content, source.encoded.content, `Destination ${metaDataId} receives the original ORU`);
      assertNormalizedEqual(destination.encoded.content, metaDataId === 5 ? await fixture("samples/patient-identifier.json") : expected,
        `Destination ${metaDataId} output`);
    }
  });

  test("the inline FML executes the default sample in Web Admin", async () => {
    const session = await signIn();
    try {
      await openStep(session.page, "03 HL7v2 to Patient - OieMessage", "PID to Patient", "Standard HL7v2 to Patient");
      const editor = session.page.locator(".fhir-fml");
      await editor.getByRole("tab", { name: "Map", exact: true }).click();
      await editor.locator(".monaco-editor").waitFor();
      const source = await session.page.evaluate(() => window.monaco.editor.getEditors()
        .find(e => e.getDomNode()?.closest(".fml-map-editor"))?.getValue());
      assert.match(source, /group OruPidToPatient/);
      await editor.getByRole("tab", { name: "Test", exact: true }).click();
      await editor.getByRole("button", { name: /Full screen/ }).click();
      assert.equal(await editor.getByRole("combobox").count(), 1);
      assert.equal(await editor.getByRole("button", { name: "How is the sample interpreted?" }).getAttribute("aria-expanded"), "false");
      const actions = await editor.locator(".fml-test-actions").boundingBox();
      const run = await editor.getByRole("button", { name: "Run test", exact: true }).boundingBox();
      assert.ok(run.y >= actions.y && run.y + run.height <= actions.y + actions.height);
      const reply = session.page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
      await editor.getByRole("button", { name: "Run test", exact: true }).click();
      const result = await (await reply).json();
      assertCleanTestResult(result, "Web Admin Run test");
      assert.equal(result.validationPerformed, true);
      assertNormalizedEqual(result.output, expected, "Web Admin default sample output");
      assert.equal(await editor.getByRole("tab", { name: "Result", exact: true }).getAttribute("aria-selected"), "true");
      assert.equal(await editor.getByRole("combobox", { name: "Sample format" }).isVisible(), false);
      await editor.getByRole("tab", { name: /^Validation/ }).click();
      await editor.getByText(/^Valid\.|^Validation: 0 error/).waitFor();
      for (const size of [{ width: 1600, height: 900 }, { width: 1100, height: 800 }]) {
        await session.page.setViewportSize(size);
        for (const name of ["Sample", "FML source", "Result", "Validation"]) {
          await editor.getByRole("tab", name === "Validation" ? { name: /^Validation/ } : { name, exact: true }).click();
          await waitForFmlLayout(session.page);
          assert.equal(await editor.locator(".fml-test-panel:visible").count(), 1);
          const box = await editor.locator(".fml-test-panel:visible").boundingBox();
          assert.ok(box.height > 150);
          assert.ok(box.y + box.height <= size.height);
        }
      }
      await session.page.setViewportSize({ width: 1600, height: 1100 });
      await editor.getByRole("tab", { name: "Sample", exact: true }).click();
      await editor.getByRole("tab", { name: "Sample", exact: true }).press("ArrowRight");
      assert.equal(await editor.getByRole("tab", { name: "FML source", exact: true }).getAttribute("aria-selected"), "true");
      await editor.getByRole("tab", { name: "Result", exact: true }).click();
      await waitForFmlLayout(session.page);
      await session.page.waitForFunction(() => document.querySelector("#fml-test-panel-result .view-lines")?.textContent.includes("resourceType"));
      assert.deepEqual(session.pluginErrors(), []);
      await session.page.screenshot({ path: `${REPO_ROOT}/webadmin/test/e2e/output/dev-oru-patient.png`, animations: "disabled" });
    } finally { await session.close(); }
  });

  test("each destination opens Test with its sample and executes without pasting", async () => {
    for (const [stepName, format, sample, output] of [
      ["Strict PID to Patient", "channel", "oru-r01.er7", "patient.json"],
      ["Prepared XML to Patient", "xml", "prepared-patient.xml", "patient.json"],
      ["Prepared JSON to Patient", "json", "prepared-patient.json", "patient.json"],
      ["Prepared text to Patient", "text", "prepared-identifier.txt", "patient-identifier.json"]]) {
      const session = await signIn();
      try {
        await openStep(session.page, "03 HL7v2 to Patient - OieMessage", stepName, format === "channel" ? "Strict HL7v2 to Patient" : stepName);
        const editor = session.page.locator(".fhir-fml");
        await editor.getByRole("tab", { name: "Test", exact: true }).click();
        await editor.getByRole("button", { name: /Full screen/ }).click();
        assert.equal(await editor.getByRole("combobox", { name: "Sample format" }).inputValue(), format);
        const message = await session.page.evaluate(() => window.monaco.editor.getEditors()
          .find(e => e.getDomNode()?.closest("#fml-test-panel-sample"))?.getValue());
        assert.equal(normalizeSample(message), normalizeSample(await fixture(`samples/${sample}`)));
        const reply = session.page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
        await editor.getByRole("button", { name: "Run test", exact: true }).click();
        const result = await (await reply).json();
        assertCleanTestResult(result, stepName);
        assertNormalizedEqual(result.output, await fixture(`samples/${output}`), stepName);
        assert.deepEqual(session.pluginErrors(), []);
      } finally { await session.close(); }
    }
  });

  test("validation errors select Validation, while input errors remain visible in Sample", async () => {
    const session = await signIn();
    const { page } = session;
    try {
      await openStep(page, "03 HL7v2 to Patient - OieMessage", "PID to Patient", "Standard HL7v2 to Patient");
      const editor = page.locator(".fhir-fml");
      await editor.getByRole("tab", { name: "Test", exact: true }).click();
      await page.route("**/fhir-fml/test", route => route.fulfill({ json: {
        model: { resourceType: "OieMessage" }, output: '{"resourceType":"Patient"}', validationPerformed: true, errors: [],
        issues: [{ severity: "error", location: "Patient.name", message: "Missing name" },
          { severity: "warning", location: "Patient.birthDate", message: "Missing birth date" }]
      } }));
      await editor.getByRole("button", { name: "Run test", exact: true }).click();
      await editor.getByText("error Patient.name: Missing name", { exact: true }).waitFor();
      assert.equal(await editor.getByRole("tab", { name: "Validation (2)", exact: true }).getAttribute("aria-selected"), "true");
      await editor.getByRole("tab", { name: "Result", exact: true }).click();
      await editor.getByText("Transformation succeeded.", { exact: true }).waitFor();
      await editor.getByRole("tab", { name: "Sample", exact: true }).click();
      await editor.getByRole("combobox", { name: "Sample format", exact: true }).selectOption("xml");
      await editor.getByText("Run again to update the result and validation.", { exact: true }).waitFor();
      await page.unroute("**/fhir-fml/test");
      await page.route("**/fhir-fml/test", route => route.fulfill({ json: {
        output: null, validationPerformed: false, issues: [], errors: [{ phase: "input", message: "Invalid sample" }]
      } }));
      await editor.getByRole("button", { name: "Run test", exact: true }).click();
      await editor.getByText("input: Invalid sample", { exact: true }).waitFor();
      assert.equal(await editor.getByRole("tab", { name: "Sample", exact: true }).getAttribute("aria-selected"), "true");
      await editor.getByRole("tab", { name: "Validation", exact: true }).click();
      await editor.getByText("FHIR validation not performed.", { exact: true }).waitFor();
      assert.deepEqual(session.pluginErrors(), []);
    } finally { await session.close(); }
  });

});
