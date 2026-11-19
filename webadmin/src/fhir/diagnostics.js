// SPDX-License-Identifier: MPL-2.0
import { t as tr } from "../i18n/index.js";
// Diagnostics of the compiler and the test API, and the events of a trace, as
// the editor shows them and links them to rules.

export function mapperDiagnostic(error) {
  const step = error.step || {};
  const label = [step.name || (step.sequenceNumber ? tr("fhir.step_number", { number: step.sequenceNumber }) : ""), error.phase, error.errorType, error.key,
    error.line ? tr("fhir.line_number", { number: error.line }) : ""].filter(Boolean).join(" · ");
  const target = Array.isArray(error.path) ? [step.resourceType || "", ...error.path.map(([name, instance]) => name + (instance === undefined ? "" : `[${instance}]`))].filter(Boolean).join(".") : "";
  const kind = error.operation === "iteration" ? "each" : error.operation === "condition" ? "condition" : error.phase === "translation" ? "translate" : "value";
  return { label, target, kind };
}

export function traceRows(trace) {
  return trace.events.map(event => ({
    event,
    label: mapperDiagnostic({ ...event, step: trace.steps?.find(step => String(step.sequenceNumber) === String(event.step)) || trace.step }).label,
    duration: `${(Number(event.durationNanos) / 1000000).toFixed(3)} ms`,
    iterations: (event.iterations || []).map(item => tr("fhir.rule_rule_item_index", { rule: item.ruleIndex, index: item.index })).join(" / ")
  }));
}

export const traceExport = trace => JSON.stringify(trace, null, 2);

/** Masks random identities so two results of the same mapping compare equal. */
export function normalizeResult(text) {
  if (text == null) return "";
  let json;
  try { json = JSON.stringify(JSON.parse(text), (_, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value, 2); } catch { json = String(text); }
  const identities = new Map();
  return json.replace(/urn:uuid:[0-9a-f-]{36}/gi, value => {
    const key = value.toLowerCase();
    if (!identities.has(key)) identities.set(key, `urn:uuid:<uuid-${identities.size}>`);
    return identities.get(key);
  }).replace(/"lastUpdated"\s*:\s*"[^"]*"/g, '"lastUpdated": "<time>"');
}
