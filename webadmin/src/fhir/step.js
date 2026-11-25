// SPDX-License-Identifier: MPL-2.0
import { t as tr } from "../i18n/index.js";
import { parseMappings } from "./model.js";
export const MAPPER_TYPE = "fr.kazepoy.fhir.mapper.FhirMapperTransformStep";
export function mapperSourcePaths(sample) {
  const paths = [];
  const add = (path) => { if (!paths.includes(path) && paths.length < 200) paths.push(path); };
  try {
    if (sample.dataType === "JSON") {
      const walk = (value, path, depth) => {
        if (depth > 5 || paths.length >= 200 || !value || typeof value !== "object") return;
        if (Array.isArray(value)) { if (value.length) { add(`${path}[0]`); walk(value[0], `${path}[0]`, depth + 1); } }
        else for (const key of Object.keys(value)) { const next = `${path}[${JSON.stringify(key)}]`; add(next); walk(value[key], next, depth + 1); }
      };
      walk(JSON.parse(sample.message), "msg", 0);
    } else if (sample.dataType === "XML") {
      const doc = new DOMParser().parseFromString(sample.message, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) return [];
      const walk = (node, path, depth) => {
        if (depth > 5 || paths.length >= 200) return;
        for (const child of node.children) { const next = `${path}[${JSON.stringify(child.localName)}]`; add(next); walk(child, next, depth + 1); }
      };
      walk(doc.documentElement, "msg", 0);
    }
  } catch { /* An incomplete sample offers no source paths. */ }
  return paths;
}

export function mapperHelpUrl(version, type, key = type) {
  const release = ["R4", "R4B", "R5"].includes(version) ? version : "R4";
  if (!/^[A-Z][A-Za-z0-9]+$/.test(type || "")) return `https://hl7.org/fhir/${release}/`;
  const field = key.split(".")[1]?.replace(/:[^.]*/, "").replace(/\[\d+\]/g, "");
  return `https://hl7.org/fhir/${release}/${type.toLowerCase()}-definitions.html#${encodeURIComponent(type + (field ? "." + field : ""))}`;
}

const JSON_ARRAY_FIELDS = ["mappings", "bundleTargets", "samples"];

function normalizeArrayField(value, field) {
  if (value === undefined || value === null) return value;
  const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
  if (!Array.isArray(parsed)) throw new Error(tr("fhir.p0_must_be_a_string_containing", { p0: field }));
  return JSON.stringify(parsed);
}

export function mapperJsonExport(element) {
  const out = {};
  for (const [key, value] of Object.entries(element || {})) {
    if (JSON_ARRAY_FIELDS.includes(key) && typeof value === "string") {
      try {
        const parsed = JSON.parse(value || "[]");
        if (Array.isArray(parsed)) { out[key] = parsed; continue; }
      } catch { /* Keep malformed raw string so the user can fix it in JSON. */ }
    }
    out[key] = value;
  }
  return out;
}

export function mapperJsonImport(element, text) {
  const patch = JSON.parse(text);
  if (!patch || Array.isArray(patch) || typeof patch !== "object") throw new Error(tr("fhir.expected_a_step_json_object"));
  for (const key of ["__proto__", "constructor", "prototype"]) if (Object.prototype.hasOwnProperty.call(patch, key)) throw new Error(tr("fhir.invalid_step_property_p0", { p0: key }));
  if (patch.__type && patch.__type !== MAPPER_TYPE) throw new Error(tr("fhir.this_is_not_a_fhir_mapper"));
  const merged = { ...element, ...patch, __type: element.__type || MAPPER_TYPE,
    sequenceNumber: element.sequenceNumber, enabled: element.enabled };
  if (!["resource", "createBundle"].includes(merged.action) || !merged.resourceType) throw new Error(tr("fhir.an_action_and_resourcetype_are_required"));
  for (const field of ["mappings", "bundleTargets"]) {
    merged[field] = normalizeArrayField(merged[field] ?? "[]", field);
  }
  if ("samples" in patch && patch.samples !== undefined && patch.samples !== null) {
    merged.samples = normalizeArrayField(patch.samples, "samples");
  }
  const allowed = new Set(["id", "key", "element", "type", "expression", "path", "each", "variable", "condition", "fixed", "when", "translate", "note", "disabled"]);
  for (const rule of JSON.parse(merged.mappings || "[]")) {
    if (!rule || typeof rule !== "object" || !Array.isArray(rule.path)) throw new Error(tr("fhir.every_rule_needs_a_path"));
    for (const key of Object.keys(rule)) if (!allowed.has(key)) throw new Error(tr("fhir.unknown_rule_property_p0", { p0: key }));
  }
  merged.mappings = JSON.stringify(mapperRuleIds(JSON.parse(merged.mappings || "[]"), parseMappings(element.mappings)));
  return merged;
}

export function mapperRuleKey(rule) {
  return `${"each" in rule ? "each" : "condition" in rule ? "condition" : "fixed" in rule ? "fixed" : "value"}:${rule.key || rule.element}`;
}

export function mapperRuleIds(entries, previous = [], createId = () => crypto.randomUUID()) {
  const identity = mapperRuleKey;
  const known = new Map(previous.filter((rule) => rule.id).map((rule) => [identity(rule), rule.id]));
  const used = new Set();
  return entries.map((rule) => {
    const id = rule.id === undefined ? known.get(identity(rule)) || createId() : rule.id;
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id) || used.has(id)) throw new Error(tr("fhir.rule_ids_must_be_valid_and"));
    used.add(id);
    return { ...rule, id };
  });
}
