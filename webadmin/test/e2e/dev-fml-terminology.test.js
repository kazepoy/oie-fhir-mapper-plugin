// SPDX-License-Identifier: MPL-2.0
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { steps } from "../../../tools/channel_mapping.mjs";
import { createOieClient, readRepoFile, fmlSteps, assertCleanTestResult, assertNormalizedEqual, connectorOf, asList } from "./oie-client.js";

let client, http, channel, step, sharedStep;
before(async () => {
  client = await createOieClient();
  http = await request.newContext();
  const [root] = steps(await readRepoFile("demo/oie-init/data/channels/02-adt-a28-patient-terminology.xml"), { includeFml: true });
  channel = await client.channel(root.findtext("id"));
  const destinations = asList(channel.destinationConnectors.connector);
  [step] = fmlSteps(destinations[0].transformer);
  [sharedStep] = fmlSteps(destinations[1].transformer);
});
after(async () => { await http?.dispose(); await client?.close(); });

test("Hades serves the preloaded ConceptMap and both code systems", async () => {
  const base = process.env.TERM_SERVER_URL || "http://127.0.0.1:8500/fhir";
  for (const [code, gender] of [["F", "female"], ["M", "male"], ["O", "other"], ["U", "unknown"]]) {
    const response = await http.get(`${base}/ConceptMap/$translate`, { params: {
      url: "http://example.org/fml-demo/ConceptMap/v2-sex-to-gender", system: "http://terminology.hl7.org/CodeSystem/v2-0001", code
    } });
    assert.equal(response.status(), 200);
    const parameters = (await response.json()).parameter;
    assert.equal(parameters.find(p => p.name === "result").valueBoolean, true);
    assert.equal(parameters.find(p => p.name === "match").part.find(p => p.name === "concept").valueCoding.code, gender);
  }
  for (const [system, code] of [["http://terminology.hl7.org/CodeSystem/v2-0001", "F"], ["http://hl7.org/fhir/administrative-gender", "female"]]) {
    const response = await http.get(`${base}/CodeSystem/$lookup`, { params: { system, code } });
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).resourceType, "Parameters");
  }
});

test("02 previews a Patient with remote translate, and cannot translate without the server", async () => {
  assert.equal(channel.name, "02 ADT A28 to Patient - Terminology");
  assert.equal(step.terminologyServer, "http://term-server:8500/fhir");
  assert.equal(step.profiles || "", "", "The ConceptMap is served only by Hades");
  assert.equal(Number(step.cacheSeconds), 0, "Every preview sends a real remote request");
  const payload = { step, inputMode: "prepared", format: "xml", message: step.sampleMessage };
  const result = await client.postTest("/api/extensions/fhir-fml/test", payload);
  assertCleanTestResult(result, "Remote terminology preview");
  assert.equal(result.validationPerformed, true);
  assertNormalizedEqual(result.output, await readRepoFile("demo/oie-init/data/samples/patient.json"));
  const local = await client.postTest("/api/extensions/fhir-fml/test", { ...payload, step: { ...step, terminologyServer: "" } });
  assert.ok(local.errors.length > 0);
  assert.match(local.errors[0].message, /ConceptMap.*not in the profiles/);
});

test("02 transforms A28 PID-8 F/M/O/U through Hades in the deployed channel", async () => {
  const original = await readRepoFile("demo/oie-init/data/samples/adt-a28.er7");
  for (const [code, gender] of [["F", "female"], ["M", "male"], ["O", "other"], ["U", "unknown"]]) {
    const input = original.replace(/^PID\|[^\r\n]*/m, segment => { const fields = segment.split("|"); fields[8] = code; return fields.join("|"); });
    const previous = await client.latestMessageId(channel.id);
    const response = await client.postChannel(10805, "/fml-terminology", input, "text/plain");
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.text).gender, gender);
    const message = await client.waitNextMessage(channel.id, previous);
    const sourceXml = connectorOf(message, 0).encoded.content;
    assert.match(sourceXml, /<MSH\.9\.2>A28<\/MSH\.9\.2>/);
    assert.doesNotMatch(sourceXml, /<(ORC|OBR|OBX)>/);
    for (const connector of [1, 2]) {
      const tracked = connectorOf(message, connector);
      assert.equal(tracked.status, "SENT", JSON.stringify(tracked.errors));
      const entry = asList(tracked.channelMapContent?.content?.entry).find(e => e.string?.[0] === `FML_TRACE_D${connector}_S0`);
      assert.ok(entry, "Each destination has its own trace");
      const trace = JSON.parse(entry.string[1]);
      assert.equal(trace.output.gender, gender);
      assert.equal(trace.validationPerformed, true);
      assert.equal(trace.parameters.terminologyServer, "http://term-server:8500/fhir");
      if (connector === 2) {
        const expected = JSON.parse(await readRepoFile("demo/oie-init/data/samples/adt-a28/patient-profile.json"));
        expected.gender = gender;
        assertNormalizedEqual(tracked.encoded.content, expected);
        assert.equal(trace.parameters.profiles, "/fhir-volume/02-adt-patient-context");
      }
    }
  }
});


test("02 destination 2 inherits resources and terminology from Settings", async () => {
  const settings = await client.getJson("/api/extensions/fhir-mapper/settings");
  const context = settings.contexts.find(c => c.name === "patient-r4");
  assert.ok(context);
  assert.deepEqual(context.packages, ["/fhir-volume/02-adt-patient-context"]);
  assert.equal(context.terminologyServer, "http://term-server:8500/fhir");
  assert.equal(sharedStep.context, context.name);
  assert.equal(sharedStep.terminologyServer || "", "");
  assert.equal(sharedStep.mapSource || "", "");
  assert.equal(sharedStep.mapUrl, "http://example.org/fml-demo/StructureMap/AdtA28ToDemoPatient");
  const result = await client.postTest("/api/extensions/fhir-fml/test", {
    step: sharedStep, inputMode: "prepared", format: "xml", message: sharedStep.sampleMessage
  });
  assertCleanTestResult(result, "Shared context preview");
  assert.equal(result.validationPerformed, true);
  assertNormalizedEqual(result.output, await readRepoFile("demo/oie-init/data/samples/adt-a28/patient-profile.json"));
});

test("02 destination 2 opens its shared context and executes its sample in Web Admin", async () => {
  const { signIn, openStep } = await import("./session.js");
  const session = await signIn();
  try {
    await openStep(session.page, "02 ADT A28 to Patient - Terminology", "Patient with profile and context", "Settings context to Patient");
    const editor = session.page.locator(".fhir-fml");
    assert.equal(await editor.getByRole("combobox", { name: "FHIR context", exact: true }).inputValue(), "patient-r4");
    assert.equal(await editor.getByRole("combobox", { name: "Map from the context", exact: true }).inputValue(), sharedStep.mapUrl);
    await editor.getByRole("tab", { name: "Test", exact: true }).click();
    const reply = session.page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    const result = await (await reply).json();
    assertCleanTestResult(result, "Shared context in Web Admin");
    assertNormalizedEqual(result.output, await readRepoFile("demo/oie-init/data/samples/adt-a28/patient-profile.json"));
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});
