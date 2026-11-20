// Tests of the FHIR FML Transform step registration (web/fml-transform.js).
import test from "node:test";
import assert from "node:assert/strict";
import { fmlSample, fmlTestRequest } from "../../src/fml/test-input.js";
import { register, FML_TYPE } from "../../src/fml/editor.js";

function platform() {
  const types = new Map();
  return {
    types,
    React: { createElement: () => null },
    oie: { STEP_TYPES: {} },
    registerStepType: (type, definition) => types.set(type, definition)
  };
}

test("registers the step with the defaults of the Java step", () => {
  const p = platform();
  register(p);
  const step = p.types.get(FML_TYPE);
  assert.equal(step.label, "FHIR FML Transform");
  assert.equal(p.oie.STEP_TYPES[FML_TYPE].label, "FHIR FML Transform");
  assert.deepEqual(step.create(), {
    __type: "fr.kazepoy.fhir.fml.FhirFmlTransformStep", name: "", enabled: true, fhirVersion: "R4", profiles: "", mapUrl: "", mapSource: "",
    sourceModel: "fhir", context: "",
    variable: "", validateOutput: true, validationOverride: null, traceMessages: false, contextVariables: "", terminologyServer: "", terminologyAuthorization: "", cacheSeconds: 300, timeoutSeconds: 10, sampleMessage: "", sampleFormat: "", sampleVariables: ""
  });
});

test("asks for a map before saving", () => {
  const p = platform();
  register(p);
  const { validate, create } = p.types.get(FML_TYPE);
  assert.equal(validate(create()), "Write the map in the Map tab, or choose the map to run.");
  assert.equal(validate({ ...create(), mapSource: "map \"u\" = \"n\"" }), "");
  assert.equal(validate({ ...create(), mapUrl: "http://example.org/fhir/StructureMap/OruPatient" }), "");
  assert.equal(validate({ ...create(), mapUrl: "http://example.org/m", sourceModel: "logical" }), "");
  assert.equal(validate({ ...create(), mapUrl: "http://example.org/m", sourceModel: "oie-message" }), "");
  assert.equal(validate({ ...create(), mapUrl: "http://example.org/m", variable: "  " }), "Give the Channel Map variable a name.");
});


// Test preparation must follow the owning transformer rather than datatype defaults.
test("test samples inherit options from source, destination and response transformers", () => {
  for (const owner of ["source", "destination", "response"]) {
    const step = { __type: FML_TYPE, sequenceNumber: 0, name: "Patient" };
    const transformer = { elements: [step], inboundDataType: "DELIMITED", inboundTemplate: "id;name",
      inboundProperties: { serializationProperties: { columnDelimiter: ";", quoteToken: "'" } } };
    const sourceConnector = { metaDataId: 0 };
    const destination = { metaDataId: 1 };
    (owner === "source" ? sourceConnector : destination)[owner === "response" ? "responseTransformer" : "transformer"] = transformer;
    const p = { store: { getState: () => ({ id: "c", sourceConnector }) },
      oie: { destinationsOf: () => [destination], elementsToArray: value => value || [] } };
    const initial = fmlSample(p, step);
    assert.equal(initial.transformer, transformer);
    assert.deepEqual(initial.inputContext, { source: owner === "source", response: owner === "response", id: owner === "source" ? 0 : 1 });
    assert.equal(initial.sample.message, "id;name");
    const request = fmlTestRequest(step, initial.sample, initial.transformer);
    assert.equal(request.dataType, "DELIMITED");
    assert.deepEqual(request.dataTypeProperties, transformer.inboundProperties);
    transformer.inboundProperties.serializationProperties.columnDelimiter = "|";
    assert.equal(fmlTestRequest(step, initial.sample, initial.transformer).dataTypeProperties.serializationProperties.columnDelimiter, "|");
  }
});

test("prepared samples omit Summary datatype and parser options", () => {
  for (const format of ["xml", "json", "raw"]) {
    assert.deepEqual(fmlTestRequest({}, { inputMode: "prepared", format, message: "prepared" },
      { inboundDataType: "HL7V2", inboundProperties: { serializationProperties: { useStrictParser: true } } }),
    { step: {}, inputMode: "prepared", format, message: "prepared" });
  }
});


test("embedded step samples initialize both the message and its prepared format", () => {
  for (const format of ["xml", "json", "raw"]) {
    const initial = fmlSample({}, { sampleMessage: "step sample", sampleFormat: format });
    assert.deepEqual(initial.sample, { message: "step sample", inputMode: "prepared", format });
    assert.equal(initial.key.endsWith(`:embedded:${format}`), true);
  }
});


test("a sample without a prepared format uses the owning transformer's inbound", () => {
  const initial = fmlSample({}, { sampleMessage: "<HL7Message/>", sampleFormat: "" });
  assert.equal(initial.sample.inputMode, "raw");
  assert.equal(initial.key.endsWith(":embedded:inbound"), true);
});

test("dynamic references expose only the variables required by the active map and logical model", async () => {
  const { fmlReferenceVariables } = await import("../../src/fml/test-input.js");
  const step = { mapUrl: "${fmlMapUrl}", sourceModel: "logical", sourceModelUrl: "${fmlSourceModelUrl}" };
  assert.deepEqual(fmlReferenceVariables(step), ["fmlMapUrl", "fmlSourceModelUrl"]);
  const request = fmlTestRequest(step, { message: "{}", inputMode: "prepared", format: "json",
    variables: { fmlMapUrl: "http://example.org/map", fmlSourceModelUrl: "http://example.org/model", unused: "not sent" } });
  assert.deepEqual(request.variables, { fmlMapUrl: "http://example.org/map", fmlSourceModelUrl: "http://example.org/model" });
  assert.deepEqual(fmlTestRequest(step, { message: "{}" }).variables, { fmlMapUrl: "", fmlSourceModelUrl: "" });
  assert.deepEqual(fmlReferenceVariables({ ...step, mapSource: "map inline" }), ["fmlSourceModelUrl"]);
  assert.deepEqual(fmlReferenceVariables({ ...step, sourceModel: "fhir" }), ["fmlMapUrl"]);
  assert.deepEqual(fmlReferenceVariables({ ...step, sourceModelUrl: "${fmlMapUrl}" }), ["fmlMapUrl"]);
  assert.deepEqual(fmlReferenceVariables({ mapUrl: "http://example.org/map" }), []);
});


test("saved example variables prefill the sample and separate its browser cache", () => {
  const step = { sampleMessage: "<PID/>", sampleFormat: "xml" };
  const previous = fmlSample({}, step);
  step.sampleVariables = JSON.stringify({ fmlMapUrl: "http://example.org/map", fmlSourceModelUrl: "http://example.org/model" });
  const initial = fmlSample({}, step);
  assert.deepEqual(initial.sample.variables, JSON.parse(step.sampleVariables));
  assert.notEqual(initial.key, previous.key, "Existing empty cached variables must not hide new example defaults");
  assert.deepEqual(fmlTestRequest({ ...step, mapUrl: "${fmlMapUrl}", sourceModel: "logical", sourceModelUrl: "${fmlSourceModelUrl}" }, initial.sample).variables,
    initial.sample.variables);
});
