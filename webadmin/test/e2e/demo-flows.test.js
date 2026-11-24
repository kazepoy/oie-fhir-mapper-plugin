// SPDX-License-Identifier: MPL-2.0
// Verifies end-to-end HL7v2, Two Lab Bundles, SQL XML, message trace and FML-vs-Mapper flows.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { findTraces } from "../../src/trace/message-trace.js";
import {
  asList,
  assertCleanTestResult,
  assertNormalizedEqual,
  channelId,
  connectorOf,
  createOieClient,
  mapperSteps,
  metaMapOf,
  readExample,
  readRepoFile
} from "./oie-client.js";

function collectUuidRefs(value, out = []) {
  if (typeof value === "string" && value.startsWith("urn:uuid:")) out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectUuidRefs(item, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectUuidRefs(v, out);
  return out;
}

describe("demo channel pipelines, message traces and benchmarks", () => {
  let client;

  before(async () => {
    client = await createOieClient();
  });

  after(() => client?.close());

  test("ORU R01 full & minimal bundles, multi-step preview, message trace and birthDate error", async () => {
    const oruId = await channelId("10-oru-lab-transaction-mapper.xml");
    const laboEr7 = await readExample("hl7v2/oru-r01-labo.er7");
    const minimalEr7 = await readExample("hl7v2/oru-r01-minimal.er7");
    const noDobEr7 = await readExample("hl7v2/oru-r01-sans-date-de-naissance.er7");

    const fullRes = await client.postChannel(10807, "/oru/", laboEr7, "text/plain");
    assert.equal(fullRes.status, 200);
    const fullBundle = JSON.parse(fullRes.text);
    assert.equal(fullBundle.resourceType, "Bundle");
    assert.equal(fullBundle.type, "transaction");
    assert.equal(fullBundle.entry.length, 12);
    const fullUrls = fullBundle.entry.map(e => e.fullUrl);
    assert.equal(new Set(fullUrls).size, 12);
    for (const entry of fullBundle.entry) assert.ok(entry.request?.method && entry.request?.url);
    for (const ref of collectUuidRefs(fullBundle)) assert.ok(fullUrls.includes(ref), `Dangling ref ${ref}`);

    const ch = await client.channel(oruId);
    const preview = await client.postTest("/api/extensions/fhir-mapper/test", {
      steps: mapperSteps(ch.sourceConnector?.transformer),
      message: minimalEr7,
      dataType: "HL7V2"
    });
    assertCleanTestResult(preview, "ORU minimal multi-step preview");

    const prevId = await client.latestMessageId(oruId);
    const minRes = await client.postChannel(10807, "/oru/", minimalEr7, "text/plain");
    assert.equal(minRes.status, 200);
    const minBundle = JSON.parse(minRes.text);
    assert.equal(minBundle.entry.length, 4);
    assertNormalizedEqual(minRes.text, preview.output, "ORU deployed output vs multi-step preview");

    const msg = await client.waitNextMessage(oruId, prevId);
    const traces = findTraces(msg);
    assert.ok(traces.length >= 1, "Expected fhirMapperTrace on ORU message");
    const { trace } = traces[0];
    assert.equal(trace.scope, "channel-message");
    assert.deepEqual(trace.steps.map(s => s.name), ["Patient", "Observation"]);
    for (const step of trace.steps) assert.match(step.scriptHash, /^[0-9a-f]{64}$/);
    for (const ev of trace.events) assert.equal(ev.value, undefined, "Trace should not capture values by default");
    const byPhase = phase => trace.events.filter(e => e.phase === phase);
    assert.ok(byPhase("references").some(e => e.status === "passed"));
    assert.ok(byPhase("validation").some(e => e.status === "passed"));
    assert.ok(byPhase("publication").some(e => e.status === "published"));

    const prevErrId = await client.latestMessageId(oruId);
    const errRes = await client.postChannel(10807, "/oru/", noDobEr7, "text/plain");
    assert.equal(errRes.text.trim(), "", "Expected empty HTTP body on ORU validation failure");
    const errMsg = await client.waitNextMessage(oruId, prevErrId);
    const source = connectorOf(errMsg, 0);
    assert.equal(source.status, "ERROR");
    assert.ok((source.processingErrorContent?.content || "").includes("birthDate"));
  });

  test("ORU R01 to Two Lab Bundles produces matching transaction, document and archive, and matches preview", async () => {
    const id = await channelId("12-oru-two-lab-bundles-mapper.xml");
    const laboEr7 = await readExample("hl7v2/oru-r01-labo.er7");
    const ch = await client.channel(id);

    const preview = await client.postTest("/api/extensions/fhir-mapper/test", {
      steps: mapperSteps(ch.sourceConnector?.transformer),
      message: laboEr7,
      dataType: "HL7V2"
    });
    assertCleanTestResult(preview, "Two Lab Bundles multi-step preview");

    const prevId = await client.latestMessageId(id);
    const res = await client.postChannel(10811, "/labo/", laboEr7, "text/plain");
    assert.equal(res.status, 200);
    const tx = JSON.parse(res.text);
    assert.equal(tx.type, "transaction");
    assert.equal(tx.entry.length, 12);

    const msg = await client.waitNextMessage(id, prevId);
    const enc1 = connectorOf(msg, 1).encoded?.content;
    const enc2 = connectorOf(msg, 2).encoded?.content;
    const dest3 = connectorOf(msg, 3);
    assertNormalizedEqual(enc1, res.text, "Connector 1 encoded should match HTTP transaction bundle");

    const doc = JSON.parse(enc2);
    assert.equal(doc.type, "document");
    assert.equal(doc.entry.length, 14);
    assert.equal(doc.entry[0].resource.resourceType, "Composition");
    const docByUrl = new Map(doc.entry.map(e => [e.fullUrl, e.resource]));
    for (const entry of tx.entry) assert.deepEqual(docByUrl.get(entry.fullUrl), entry.resource);

    assertNormalizedEqual(dest3.encoded?.content, enc2, "Connector 3 encoded should match document bundle");
    assert.ok((dest3.response?.content || "").includes("archive-pca/labo-document-"), "Expected archive filename in response");

    assertNormalizedEqual(preview.output, res.text, "Preview transaction vs deployed");
    assertNormalizedEqual(preview.variables?.bundleDocument, enc2, "Preview document variable vs deployed");
  });

  test("the SQL XML channel preserves business identifiers and accents", async () => {
    const sqlXml = await readExample("xml/patient-result-sql.xml");
    const sqlExpected = await readExample("xml/patient-result-sql-expected.json");
    const sqlRes = await client.postChannel(10812, "/sql-patient/", sqlXml, "application/xml");
    assert.equal(sqlRes.status, 200);
    assertNormalizedEqual(sqlRes.text, sqlExpected, "SQL XML output mismatch");
    const patient = JSON.parse(sqlRes.text);
    assert.equal(patient.name[0].given[0], "Élodie");
    assert.equal(patient.identifier[0].value, "000123456");
  });

  test("the active FML-vs-Mapper channel runs destinations in parallel and compares their outputs and timings", async () => {
    const id = await channelId("17-oru-patient-fml-vs-mapper.xml");
    const ch = await client.channel(id);
    const waitFlags = asList(ch.destinationConnectors?.connector).map(c => c.waitForPrevious);
    assert.deepEqual(waitFlags.slice(0, 2), [false, false]);
    const input = await readRepoFile("demo/oie-init/data/samples/restored/oru-patient.er7");
    const expected = await readRepoFile("demo/oie-init/data/samples/restored/oru-patient-expected.json");
    const prevId = await client.latestMessageId(id);
    const response = await client.postChannel(10817, "/patient-compare", input, "text/plain");
    assert.equal(response.status, 200, response.text);
    assertNormalizedEqual(response.text, expected);

    const msg = await client.waitNextMessage(id, prevId);
    assertNormalizedEqual(connectorOf(msg, 1).encoded?.content, expected, "FML destination");
    assertNormalizedEqual(connectorOf(msg, 2).encoded?.content, expected, "Mapper destination");
    const sourceMeta = metaMapOf(connectorOf(msg, 0));
    assert.ok(Number(sourceMeta.FML_MS) > 0);
    assert.ok(Number(sourceMeta.MAPPER_MS) > 0);
    assert.equal(String(sourceMeta.OUTPUTS_EQUAL), "true");
    assert.equal(String(sourceMeta.ERROR_STEP), "OK");
  });
});
