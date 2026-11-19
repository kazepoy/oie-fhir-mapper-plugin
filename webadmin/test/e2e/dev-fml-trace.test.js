// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { apply } from "../../../tools/channel_mapping.mjs";
import { createOieClient, OIE_URL, PASSWORD, connectorOf, asList, readRepoFile } from "./oie-client.js";

// Restore the exact live channel after verifying the generated script in the OIE runtime.
test("FML trace is stored in message tracking on success and validation failure", async () => {
  const id = "8f4a19a4-2018-40c1-8e08-3e8361841907";
  const headers = { "X-Requested-With": "OpenAPI", Accept: "application/json" };
  const client = await createOieClient();
  const admin = await request.newContext({ baseURL: OIE_URL, ignoreHTTPSErrors: true, extraHTTPHeaders: headers });
  let original;
  const install = async xml => {
    const imported = await admin.put(`/api/channels/${id}?override=true`, { data: xml, headers: { "Content-Type": "application/xml" } });
    assert.equal(imported.status(), 200, await imported.text());
    assert.equal((await imported.json()).boolean, true);
    const deployed = await admin.post(`/api/channels/${id}/_deploy?returnErrors=true`);
    assert.equal(deployed.status(), 204, await deployed.text());
  };
  try {
    const login = await admin.post("/api/users/_login", { form: { username: "admin", password: PASSWORD } });
    assert.equal(login.status(), 200);
    original = await client.getText(`/api/channels/${id}`);
    const sample = await readRepoFile("demo/oie-init/data/samples/adt-a28.er7");
    const send = async () => {
      const previous = await client.latestMessageId(id);
      await client.postChannel(10804, "/simple-fml", sample, "text/plain");
      const destination = connectorOf(await client.waitNextMessage(id, previous), 1);
      const entry = asList(destination.channelMapContent?.content?.entry).find(e => e.string?.[0] === "FML_TRACE_D1_S0");
      assert.ok(entry, "Trace must be present in the tracked destination Channel Map");
      return { destination, trace: JSON.parse(entry.string[1]) };
    };
    await install(apply(original, 1, 0, { traceMessages: true }));
    let { destination, trace } = await send();
    assert.equal(destination.status, "SENT");
    assert.equal(trace.status, "success");
    assert.equal(trace.validationPerformed, true);
    assert.equal(trace.fmlSource.resourceType, "OieMessage");
    assert.equal(trace.output.resourceType, "Patient");
    assert.match(trace.input, /<PID\.5\.1>MARTIN/);
    const mapSource = 'map "http://example.org/invalid" = "Invalid"\n'
      + 'uses "http://oie.org/fhir/StructureDefinition/OieMessage" alias OieMessage as source\n'
      + 'uses "http://hl7.org/fhir/StructureDefinition/Patient" alias Patient as target\n'
      + 'group Invalid(source src : OieMessage, target tgt : Patient) { src -> tgt.gender = \'invalid\' "gender"; }';
    await install(apply(original, 1, 0, { traceMessages: true, mapSource, validationOverride: true }));
    ({ destination, trace } = await send());
    assert.equal(destination.status, "ERROR");
    assert.equal(trace.status, "error");
    assert.equal(trace.phase, "validation");
    assert.ok(trace.issues.some(i => ["error", "fatal"].includes(i.severity)));
    await install(apply(original, 1, 0, { traceMessages: true, mapSource, validationOverride: false }));
    ({ destination, trace } = await send());
    assert.equal(destination.status, "SENT");
    assert.equal(trace.validationPerformed, false);
    assert.equal(trace.output.gender, "invalid");
  } finally {
    try { if (original) await install(original); }
    finally { await admin.dispose(); await client.close(); }
  }
});
