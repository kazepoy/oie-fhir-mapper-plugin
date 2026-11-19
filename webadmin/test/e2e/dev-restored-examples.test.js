// SPDX-License-Identifier: MPL-2.0
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { steps } from "../../../tools/channel_mapping.mjs";
import { createOieClient, readRepoFile, fmlSteps, assertCleanTestResult, assertNormalizedEqual } from "./oie-client.js";

let client;
const fixture = p => readRepoFile(`demo/oie-init/data/${p}`);
before(async () => { client = await createOieClient(); });
after(() => client?.close());
async function channel(file) {
  const [root] = steps(await fixture(`channels/${file}`), { includeFml: true });
  const current = await client.channel(root.findtext("id"));
  assert.equal(current.name, root.findtext("name"));
  return current;
}

test("07 CSV FML produces an R5 Organization and Permission with a resolved asserter", async () => {
  const ch = await channel("07-csv-permission-r5-fml.xml");
  const [step] = fmlSteps(ch.sourceConnector.transformer);
  assert.equal(step.fhirVersion, "R5");
  const input = await fixture("samples/restored/permissions-r5.csv");
  const expected = await fixture("samples/restored/permissions-r5-expected.json");
  const preview = await client.postTest("/api/extensions/fhir-fml/test", { step, message: input, dataType: "DELIMITED",
    dataTypeProperties: ch.sourceConnector.transformer.inboundProperties });
  assertCleanTestResult(preview, "CSV R5 preview");
  assertNormalizedEqual(preview.output, expected);
  const response = await client.postChannel(10814, "/permission-r5", input, "text/csv");
  assert.equal(response.status, 200);
  assertNormalizedEqual(response.text, expected);
  const bundle = JSON.parse(response.text);
  const organization = bundle.entry.find(e => e.resource.resourceType === "Organization");
  const permission = bundle.entry.find(e => e.resource.resourceType === "Permission");
  assert.equal(permission.resource.asserter.reference, organization.fullUrl);
  const invalid = await client.postTest("/api/extensions/fhir-fml/test", { step, message: await fixture("samples/restored/permissions-r5-invalid.csv"), dataType: "DELIMITED",
    dataTypeProperties: ch.sourceConnector.transformer.inboundProperties });
  assert.ok(invalid.errors.length || invalid.issues.some(i => ["error", "fatal"].includes(i.severity)));
});

test("08 a published JSON StructureMap runs, renders to inline FML, and rejects a missing birth date", async () => {
  const ch = await channel("08-oru-patient-structuremap.xml");
  const [step] = fmlSteps(ch.sourceConnector.transformer);
  assert.equal(step.mapSource || "", "");
  const input = await fixture("samples/restored/oru-patient.er7");
  const expected = await fixture("samples/restored/oru-patient-expected.json");
  const response = await client.postChannel(10815, "/patient-fml-ig", input, "text/plain");
  assert.equal(response.status, 200);
  assertNormalizedEqual(response.text, expected);
  const query = new URLSearchParams({ url: step.mapUrl, fhirVersion: "R4", profiles: step.profiles });
  const source = await client.getText(`/api/extensions/fhir-fml/map?${query}`, "text/plain");
  assert.ok(source.includes("group OruR01ToPatient"));
  const preview = await client.postTest("/api/extensions/fhir-fml/test", { step: { ...step, mapSource: source }, message: input, dataType: "HL7V2" });
  assertCleanTestResult(preview, "JSON StructureMap rendered to FML");
  assertNormalizedEqual(preview.output, expected);
  const invalid = await client.postTest("/api/extensions/fhir-fml/test", { step, message: await fixture("samples/restored/oru-patient-missing-birthdate.er7"), dataType: "HL7V2" });
  assert.ok(invalid.errors.length || invalid.issues.some(i => ["error", "fatal"].includes(i.severity) && /birthDate/.test(i.location + i.message)));
});

test("09 business CSV cleanup produces ten Patients while preserving accents and leading zeroes", async () => {
  await channel("09-csv-patient-bundle-mapper.xml");
  const response = await client.postChannel(10806, "/csv-patients-collection", await fixture("samples/restored/business-patients.csv"), "text/csv");
  assert.equal(response.status, 200);
  const bundle = JSON.parse(response.text);
  assert.equal(bundle.type, "collection");
  assert.equal(bundle.entry.length, 10);
  const patients = bundle.entry.map(e => e.resource);
  assert.ok(patients.every(p => p.resourceType === "Patient"));
  assert.equal(patients[0].identifier[0].value, "000200001");
  assert.equal(patients[0].name[0].family, "Durand");
  assert.equal(patients[0].name[0].given[0], "Élodie");
  assert.equal(patients[0].birthDate, "1985-04-12");
  assert.equal(patients[0].gender, "female");
  assert.equal(patients[9].active, false);
});

test("10 laboratory ORU produces twelve transaction resources with OBX values and valid internal references", async () => {
  await channel("10-oru-lab-transaction-mapper.xml");
  const response = await client.postChannel(10807, "/oru", await fixture("samples/restored/oru-laboratory.er7"), "text/plain");
  assert.equal(response.status, 200);
  const bundle = JSON.parse(response.text);
  assert.equal(bundle.type, "transaction");
  assert.equal(bundle.entry.length, 12);
  const urls = new Set(bundle.entry.map(e => e.fullUrl));
  assert.equal(urls.size, 12);
  for (const entry of bundle.entry) assert.ok(entry.request.method && entry.request.url);
  const resources = bundle.entry.map(e => e.resource);
  const observations = resources.filter(r => r.resourceType === "Observation");
  assert.deepEqual(observations.filter(r => r.valueQuantity).map(r => r.valueQuantity.value).sort((a, b) => a - b), [4.1, 6.8, 78, 140]);
  assert.ok(observations.some(r => r.valueString?.includes("hémolysé")));
  const check = value => {
    if (!value || typeof value !== "object") return;
    if (typeof value.reference === "string" && value.reference.startsWith("urn:uuid:")) assert.ok(urls.has(value.reference), value.reference);
    Object.values(value).forEach(check);
  };
  resources.forEach(check);
});
