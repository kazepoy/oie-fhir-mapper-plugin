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
  let variables = {};
  try {
    const saved = JSON.parse(element.sampleVariables || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) variables = saved;
  } catch { /* no saved test variables */ }
  if (Object.keys(variables).length) key += ":variables:" + JSON.stringify(variables);
  return { key, transformer: ctx?.transformer,
    inputContext: ctx ? { source: ctx.connector === ctx.channel.sourceConnector,
      response: ctx.transformer === ctx.connector.responseTransformer, id: ctx.connector.metaDataId } : null,
    sample: { message, inputMode: element.sampleFormat ? "prepared" : "raw", format: element.sampleFormat || "xml",
      ...(Object.keys(variables).length ? { variables } : {}) } };
}

/** Variables needed by the active map and logical source references, in display order. */
export function fmlReferenceVariables(element) {
  const references = [String(element.mapSource || "").trim() ? "" : element.mapUrl,
    element.sourceModel === "logical" ? element.sourceModelUrl : ""];
  return [...new Set(references.map(value => String(value || "").trim()
    .match(/^\$\{([A-Za-z_$][A-Za-z0-9_$.-]*)\}$/)?.[1]).filter(Boolean))];
}

export function fmlTestRequest(element, sample, transformer) {
  const base = { step: element, message: sample.message, inputMode: sample.inputMode || "raw" };
  const names = fmlReferenceVariables(element);
  if (names.length) base.variables = Object.fromEntries(names.map(name => [name, sample.variables?.[name] ?? ""]));
  return base.inputMode === "prepared" ? { ...base, format: sample.format || "xml" }
    : { ...base, dataType: transformer?.inboundDataType || "", dataTypeProperties: transformer?.inboundProperties || {} };
}
