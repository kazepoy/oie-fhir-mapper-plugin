// SPDX-License-Identifier: MPL-2.0
/** The inbound template and data type of this step's transformer, as a default sample. */
export function fmlSample(platform, element) {
  const channel = platform.store?.getState("editingChannel");
  let found = null;
  let exact = null;
  if (channel) {
    const connectors = [channel.sourceConnector, ...(platform.oie.destinationsOf(channel) || [])].filter(Boolean);
    for (const connector of connectors) {
      for (const transformer of [connector.transformer, connector.responseTransformer]) {
        const steps = platform.oie.elementsToArray(transformer?.elements);
        if (steps.includes(element)) exact = { channel, connector, transformer };
        if (steps.some((s) => s.__type === "fr.kazepoy.fhir.fml.FhirFmlTransformStep" && String(s.sequenceNumber) === String(element.sequenceNumber) && s.name === element.name)) {
          found = found ? "ambiguous" : { channel, connector, transformer };
        }
      }
    }
  }
  const ctx = exact || (found && found !== "ambiguous" ? found : null);
  let key = ctx ? `fhir-fml-sample:${ctx.channel.id}:${ctx.connector.metaDataId}:${ctx.transformer === ctx.connector.responseTransformer ? "response" : "transformer"}:${element.sequenceNumber}` : "fhir-fml-sample:unknown";
  const message = element.sampleMessage || ctx?.transformer.inboundTemplate || "";
  if (element.sampleMessage) key += ":embedded:" + (element.sampleFormat || "inbound");
  return { key, transformer: ctx?.transformer,
    inputContext: ctx ? { source: ctx.connector === ctx.channel.sourceConnector,
      response: ctx.transformer === ctx.connector.responseTransformer, id: ctx.connector.metaDataId } : null,
    sample: { message, inputMode: element.sampleFormat ? "prepared" : "raw", format: element.sampleFormat || "xml" } };
}

export function fmlTestRequest(element, sample, transformer) {
  const base = { step: element, message: sample.message, inputMode: sample.inputMode || "raw" };
  return base.inputMode === "prepared" ? { ...base, format: sample.format || "xml" }
    : { ...base, dataType: transformer?.inboundDataType || "", dataTypeProperties: transformer?.inboundProperties || {} };
}
