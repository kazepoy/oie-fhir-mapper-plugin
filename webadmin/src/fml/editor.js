// SPDX-License-Identifier: MPL-2.0
import { t as tr } from "../i18n/index.js";
// ---------------------------------------------------------------------------------------------
// FHIR FML Transform transformer step (fr.kazepoy.fhir.fml.FhirFmlTransformStep). The step runs an FML
// map (StructureMap) found in its profile locations on the message, seen through the generic OIE
// logical model (OieMessage), and publishes the FHIR resource it makes. The maps are written
// elsewhere: this editor only chooses one and tests it on a sample message.
// ---------------------------------------------------------------------------------------------

import { createExpressionEditor, registerLanguage } from "../host/code-editor.js";
import { FML_LANGUAGE, FML_TEMPLATE } from "./language.js";
import { fmlCompletions, fmlSkeleton } from "./completion.js";
import { CodeBox, languageOf } from "../host/code-box.js";
import { HelpButton } from "../host/help.js";
import { ContextFields } from "../settings/context-fields.js";
import { FML_HELP } from "../host/help-texts.js";
import { cachedFhirSettings, fhirContext, loadFhirSettings } from "../host/settings.js";

export const FML_TYPE = "fr.kazepoy.fhir.fml.FhirFmlTransformStep";
const FML_API = "/extensions/fhir-fml";
const MAPPER_API = "/extensions/fhir-mapper";
import { fmlSample, fmlTestRequest, fmlReferenceVariables } from "./test-input.js";
import { formatSample } from "./sample-format.js";


let React;
const h = (...args) => React.createElement(...args);

function errorText(e) {
  const body = (e && e.body) || "";
  const m = /<detailMessage>([\s\S]*?)<\/detailMessage>/.exec(body);
  if (m) return m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return (e && e.message) || String(e);
}

function pretty(value) {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(typeof value === "string" ? JSON.parse(value) : value, null, 2);
  } catch {
    return String(value);
  }
}

/** The map editor: the host's code editor in the fml language; markers are the problems of the last check. */
function FmlMapEditor({ value, onChange, problems, completionPaths }) {
  const host = React.useRef(null);
  const editor = React.useRef(null);
  const latest = React.useRef({ onChange, completionPaths, value });
  latest.current = { onChange, completionPaths, value };
  React.useEffect(() => {
    const ed = createExpressionEditor({ value, language: "fml", multiline: true, minHeight: "100%", ariaLabel: "FML map",
      getItems: () => fmlCompletions(editor.current?.getValue() || latest.current.value, latest.current.completionPaths),
      onChange: (text) => latest.current.onChange(text) });
    ed.el.style.height = "100%";
    editor.current = ed;
    host.current.appendChild(ed.el);
    return () => { editor.current = null; ed.dispose(); };
  }, []);
  React.useEffect(() => { if (editor.current && editor.current.getValue() !== (value || "")) editor.current.setValue(value || ""); }, [value]);
  React.useEffect(() => { editor.current?.setMarkers(problems || []); }, [problems]);
  return h("div", { ref: host, className: "fml-map-editor" });
}

function FmlTransformEditor({ element, onChange, platform }) {
  const [, rerender] = React.useReducer((x) => x + 1, 0);
  const state = React.useRef(null);
  if (state.current === null) {
    const initial = fmlSample(platform, element);
    let sample = initial.sample;
    try {
      sample = JSON.parse(localStorage.getItem(initial.key) || "null") || sample;
    } catch {
      // no storage: the transformer's inbound template
    }
    state.current = { tab: "settings", maps: null, mapErrors: {}, loading: false, loadError: "", logicalModels: null, loadingModels: false,
      sampleKey: initial.key, sample, testing: false, result: null, testTab: "sample", testedInput: null,
      skeletonTarget: "http://hl7.org/fhir/StructureDefinition/Patient", completionPaths: [] };
  }
  const st = state.current;

  const set = (prop, value) => {
    element[prop] = value;
    onChange();
    rerender();
  };
  const field = (label, control, hint, wide) =>
    h("div", { className: wide ? "field fml-wide" : "field" }, h("label", null, label), control, hint ? h("div", { className: "hint" }, hint) : null);
  const text = (prop, placeholder) => h("input", { type: "text", placeholder, value: element[prop] ?? "", onChange: (e) => set(prop, e.target.value) });

  // A step that names a FHIR context of the server takes its version and locations.
  const shared = fhirContext(element.context);
  const version = shared ? shared.fhirVersion : element.fhirVersion || "R4";
  const locations = shared ? (shared.packages || []).join(";") : element.profiles || "";
  React.useEffect(() => {
    let active = true;
    const done = () => { if (active) { st.settingsReady = true; rerender(); if (element.context && fhirContext(element.context)) loadMaps(false); } };
    loadFhirSettings().then(done, done);
    return () => { active = false; };
  }, []);
  const loadLogicalModels = async () => {
    st.loadingModels = true;
    rerender();
    try {
      const selected = fhirContext(element.context);
      const answer = JSON.parse(await platform.api.get(`${MAPPER_API}/catalog`, {
        kind: "logical",
        fhirVersion: selected?.fhirVersion || element.fhirVersion || "R4",
        profiles: selected ? (selected.packages || []).join(";") : element.profiles || ""
      }, { raw: true }));
      st.logicalModels = Array.isArray(answer) ? answer : [];
    } catch {
      st.logicalModels = [];
    }
    st.loadingModels = false;
    rerender();
  };
  const loadMaps = async (reload) => {
    st.loading = true;
    st.loadError = "";
    rerender();
    try {
      if (reload) await platform.api.post(`${FML_API}/reload`, "", { contentType: "text/plain", raw: true });
      const selected = fhirContext(element.context);
      const answer = JSON.parse(await platform.api.get(`${FML_API}/maps`, {
        fhirVersion: selected?.fhirVersion || element.fhirVersion || "R4",
        profiles: selected ? (selected.packages || []).join(";") : element.profiles || ""
      }, { raw: true }));
      st.maps = answer.maps || [];
      st.mapErrors = answer.errors || {};
    } catch (e) {
      st.maps = null;
      st.loadError = errorText(e);
    }
    st.loading = false;
    rerender();
    if ((element.sourceModel || "fhir") === "logical" && st.logicalModels === null) loadLogicalModels();
  };
  React.useEffect(() => {
    if (!element.context && (element.profiles || "").trim()) loadMaps(false);
  }, []);

  const copyMap = async () => {
    const url = element.mapUrl;
    const context = element.context;
    if (!url || fmlReferenceVariables({ mapUrl: url }).length) return;
    st.copying = true;
    st.loadError = "";
    rerender();
    try {
      const source = await platform.api.get(`${FML_API}/map`, { url, fhirVersion: version, profiles: locations }, { raw: true });
      if (element.mapUrl !== url || element.context !== context || String(element.mapSource || "").trim()) return;
      st.check = null;
      st.tab = "map";
      set("mapSource", source);
    } catch (e) {
      st.loadError = errorText(e);
    } finally {
      st.copying = false;
      rerender();
    }
  };

  const saveSample = () => {
    try {
      localStorage.setItem(st.sampleKey, JSON.stringify(st.sample));
    } catch {
      // no storage: kept while the editor is open
    }
  };
  const sampleContext = fmlSample(platform, element);
  const transformer = sampleContext.transformer;
  const supported = ["HL7V2", "XML", "JSON", "RAW", "DELIMITED", "FHIR"].includes(transformer?.inboundDataType);
  const prepared = st.sample.inputMode === "prepared";
  const sampleType = prepared ? { xml: "XML", json: "JSON", raw: "RAW" }[st.sample.format || "xml"] : transformer?.inboundDataType;
  const context = sampleContext.inputContext;
  const inputLabel = context ? context.source
    ? context.response ? tr("fml.source_response_input_type", { type: transformer.inboundDataType }) : tr("fml.source_input_type", { type: transformer.inboundDataType })
    : context.response ? tr("fml.destination_id_response_input_type", { id: context.id, type: transformer.inboundDataType })
      : tr("fml.destination_id_input_type", { id: context.id, type: transformer.inboundDataType })
    : tr("fml.transformer_input_type", { type: transformer?.inboundDataType || "—" });
  React.useEffect(() => {
    st.sampleDisplay = st.formatSample ? formatSample(st.sample.message, sampleType) : null;
    rerender();
  }, [sampleType]);
  const displayedSample = st.sampleDisplay ?? st.sample.message;
  const testInput = () => JSON.stringify(fmlTestRequest(element, st.sample, transformer));
  const runTest = async () => {
    const input = testInput();
    st.testing = true;
    st.result = null;
    rerender();
    try {
      const text = await platform.api.post(`${FML_API}/test`, input, {
        contentType: "text/plain",
        raw: true,
        timeoutMs: 120000
      });
      st.result = JSON.parse(text);
    } catch (e) {
      const message = errorText(e);
      st.result = { model: null, output: null, issues: [], errors: [{ phase: "request", message: e?.status === 403 || /Test FHIR FML transforms/.test(message)
        ? tr("fml.testing_a_step_requires_the_permission") : message }] };
    }
    st.testedInput = input;
    if ((st.result.issues || []).some(i => ["error", "fatal"].includes(i.severity))
        || (st.result.errors || []).some(e => e.phase === "validation")) st.testTab = "validation";
    else if (st.result.output && st.testTab === "sample" && input === testInput()) st.testTab = "result";
    st.testing = false;
    rerender();
  };

  const checkMap = async () => {
    st.checking = true;
    rerender();
    try {
      const text = await platform.api.post(`${FML_API}/check`, JSON.stringify({ mapSource: element.mapSource || "", fhirVersion: version, profiles: locations }),
        { contentType: "text/plain", raw: true, timeoutMs: 120000 });
      st.check = JSON.parse(text);
    } catch (e) {
      st.check = { errors: [{ line: 1, column: 1, message: errorText(e) }] };
    }
    st.checking = false;
    rerender();
  };
  const generateSkeleton = async () => {
    st.generating = true;
    st.skeletonError = "";
    rerender();
    try {
      const target = st.skeletonTarget.trim();
      if (!target) throw new Error(tr("common.choose_the_target_profile"));
      const text = await platform.api.get("/extensions/fhir-mapper/catalog/elements",
        { url: target, fhirVersion: version, profiles: locations }, { raw: true });
      const root = JSON.parse(text).root || {};
      const elements = root.snapshot?.element || root.differential?.element || [];
      st.completionPaths = elements.map(item => item.path).filter(Boolean);
      const required = elements.filter(item => Number(item.min || 0) > 0 && item.path && item.path.includes(".")).map(item => item.path);
      const model = element.sourceModel || "fhir";
      const sourceUrl = model === "oie-message" ? "https://openintegrationengine.org/fhir/StructureDefinition/OieMessage"
        : String(element.sourceModelUrl || "").trim() || "http://hl7.org/fhir/StructureDefinition/Resource";
      st.check = null;
      set("mapSource", fmlSkeleton({ sourceUrl, targetUrl: target, required }));
    } catch (e) {
      st.skeletonError = errorText(e);
    }
    st.generating = false;
    rerender();
  };
  const inline = !!String(element.mapSource || "").trim();
  const mapPanel = h("div", { className: "fml-map" },
    h("div", { className: "fml-row", style: { marginBottom: "8px" } },
      h("button", { type: "button", className: "btn btn-sm", disabled: st.checking || !inline, onClick: checkMap }, st.checking ? tr("fml.checking") : tr("common.check")),
      !inline ? h("button", { type: "button", className: "btn btn-sm", onClick: () => { st.check = null; set("mapSource", FML_TEMPLATE); } }, tr("common.start_from_an_example")) : null,
      h("input", { type: "text", value: st.skeletonTarget, "aria-label": tr("fml.target_profile_for_the_skeleton"), placeholder: tr("fml.target_profile_for_the_skeleton"),
        style: { flex: "1 1 300px" }, onChange: e => { st.skeletonTarget = e.target.value; rerender(); } }),
      h("button", { type: "button", className: "btn btn-sm", disabled: st.generating, onClick: generateSkeleton },
        st.generating ? tr("fml.generating") : tr("fml.generate_skeleton")),
      inline ? h("button", { type: "button", className: "btn btn-sm", title: tr("fml.empty_the_map_the_step_then"), onClick: () => { st.check = null; set("mapSource", ""); } }, tr("common.clear")) : null,
      st.check && !st.check.errors.length ? h("span", { className: "fml-ok" }, tr("fml.no_problem_found_p0_p1", { p0: st.check.name ? tr("fml.in_name", { name: st.check.name }) : "", p1: st.check.groups?.length ? tr("fml.groups_groups", { groups: st.check.groups.join(", ") }) : "" })) : null,
      st.check && st.check.errors.length ? h("span", { className: "fml-error" }, tr("fml.p0_problem_s", { p0: st.check.errors.length })) : null),
    st.skeletonError ? h("div", { className: "fml-error", style: { marginBottom: "6px" } }, st.skeletonError) : null,
    h(FmlMapEditor, { value: element.mapSource || "", problems: st.check?.errors || [], completionPaths: st.completionPaths,
      onChange: (text) => { element.mapSource = text; onChange(); if (!!text.trim() !== inline) rerender(); } }),
    (st.check?.errors || []).map((e, i) => h("div", { key: i, className: "fml-error", style: { marginTop: "4px" } }, tr("fml.line_p0_column_p1_p2", { p0: e.line, p1: e.column, p2: e.message }))));
  const mapOptions = st.maps || [];
  const localContext = {
    fhirVersion: element.fhirVersion || "R4", packages: String(element.profiles || "").split(";"),
    validation: element.validateOutput === false || element.validateOutput === "false" ? "off" : "always",
    terminologyServer: element.terminologyServer || "", terminologyAuthorization: element.terminologyAuthorization || "",
    cacheSeconds: element.cacheSeconds ?? 300, timeoutSeconds: element.timeoutSeconds ?? 10
  };
  const inheritedValidation = (shared || localContext).validation === "always";
  const hasValidationOverride = element.validationOverride != null && element.validationOverride !== "";
  const validationEnabled = hasValidationOverride
    ? element.validationOverride === true || element.validationOverride === "true" : inheritedValidation;
  const updateLocalContext = patch => {
    if (patch.fhirVersion !== undefined) element.fhirVersion = patch.fhirVersion;
    if (patch.packages !== undefined) { element.profiles = patch.packages.join(";"); st.maps = null; st.mapErrors = {}; }
    if (patch.validation !== undefined) element.validateOutput = patch.validation === "always";
    for (const key of ["terminologyServer", "terminologyAuthorization", "cacheSeconds", "timeoutSeconds"])
      if (patch[key] !== undefined) element[key] = patch[key];
    onChange(); rerender();
  };
  const section = (number, key, label, body) => h("section", { className: "fml-property-section", "data-section": key },
    h("h3", null, h("span", { className: "fml-flow-number" }, number), tr(label)),
    h("div", { className: "fml-property-grid" }, ...body));
  const settings = h("div", { className: "fml-properties" },
    h("section", { className: "fml-context-section" },
      field(tr("common.fhir_context"), h("select", { value: element.context || "", "aria-label": tr("common.fhir_context"), onChange: e => {
        st.maps = null; st.mapErrors = {}; st.loadError = ""; set("context", e.target.value);
        setTimeout(() => loadMaps(false), 0);
      } },
        h("option", { value: "" }, tr("common.local_context_this_step")),
        (cachedFhirSettings()?.contexts || []).map(c => h("option", { key: c.name, value: c.name }, tr("common.settings_name", { name: c.name }))),
        element.context && !shared && st.settingsReady ? h("option", { value: element.context }, tr("common.p0_not_defined_on_this_server", { p0: element.context })) : null)),
      !element.context ? h("details", { key: "local", open: true, className: "fml-context-details" },
        h("summary", null, tr("common.local_context_configuration")),
        h(ContextFields, { value: localContext, onChange: updateLocalContext }))
        : shared ? h(React.Fragment, null,
          h("p", { className: "fml-context-summary" }, tr("common.version_count_location_s_validation_policy",
            { version, count: shared.packages?.length || 0, policy: shared.validation })),
          h("details", { key: element.context, className: "fml-context-details" },
            h("summary", null, tr("common.context_details_managed_in_settings")),
            h(ContextFields, { value: shared, disabled: true })))
          : st.settingsReady ? h("p", { className: "fml-error" }, tr("common.select_a_context_defined_in_settings")) : null),
    section("1", "Source", "fml.source", [
      field(tr("fml.source_model"), h("select", { value: ["fhir", "logical", "oie-message"].includes(element.sourceModel) ? element.sourceModel : "fhir", "aria-label": tr("fml.source_model"), onChange: e => {
        if (e.target.value !== "logical") element.sourceModelUrl = "";
        set("sourceModel", e.target.value);
        if (e.target.value === "logical" && st.logicalModels === null) loadLogicalModels();
      } },
        h("option", { value: "fhir" }, tr("fml.fhir_resource")),
        h("option", { value: "logical" }, tr("fml.logical_model")),
        h("option", { value: "oie-message" }, tr("fml.generic_oie_message"))),
        tr("fml.the_source_model_is_declared_by"), true),
      (element.sourceModel || "fhir") === "logical" ? field(tr("fml.logical_model_url"), h("div", { className: "fml-row" },
        h("input", { type: "text", list: "fml-logical-models", "aria-label": tr("fml.logical_model_url"), placeholder: "${fmlSourceModelUrl}",
          value: element.sourceModelUrl ?? "", onChange: e => set("sourceModelUrl", e.target.value) }),
        h("button", { type: "button", className: "btn", disabled: st.loadingModels, onClick: loadLogicalModels },
          st.loadingModels ? tr("common.loading") : tr("fml.load_models")),
        h("datalist", { id: "fml-logical-models" },
          (st.logicalModels || []).map(m => h("option", { key: m.url, value: m.url }, m.title || m.name || m.url)))),
        tr("fml.logical_reference_hint"), true) : null,
      (element.sourceModel || "fhir") === "oie-message" ? field(tr("common.context_variables"), text("contextVariables", "site, sendingFacility"),
        tr("fml.variables_of_the_oie_maps_copied"), true) : null
    ]),
    section("2", "Map", "common.map", [
      inline ? h("div", { className: "fml-wide fml-row" }, h("span", { className: "fml-map-kind" }, tr("fml.inline_map")),
        h("span", { className: "hint" }, tr("fml.saved_in_this_step")),
        h("button", { type: "button", className: "btn btn-sm", onClick: () => { st.tab = "map"; rerender(); } }, tr("fml.edit_map")))
        : field(tr("fml.map_from_the_context"), h("div", { className: "fml-row" },
          h("input", { type: "text", value: element.mapUrl || "", list: "fml-map-urls", disabled: st.loading,
            "aria-label": tr("fml.map_from_the_context"), placeholder: "${fmlMapUrl}", onChange: e => set("mapUrl", e.target.value) }),
          h("datalist", { id: "fml-map-urls" }, mapOptions.map(m => h("option", { key: m.url, value: m.url }, m.title || m.name || m.url))),
          h("button", { type: "button", className: "btn btn-sm", disabled: st.loading || !locations.trim(), onClick: () => loadMaps(false) }, st.loading ? tr("common.loading") : tr("fml.load_maps")),
          h("button", { type: "button", className: "btn btn-sm", disabled: st.loading || !locations.trim(), onClick: () => loadMaps(true) }, tr("fml.reload")),
          h("button", { type: "button", className: "btn btn-sm", disabled: st.copying || !element.mapUrl || fmlReferenceVariables({ mapUrl: element.mapUrl }).length > 0, onClick: copyMap }, st.copying ? tr("fml.copying") : tr("fml.copy_to_inline_map"))),
          tr("fml.map_reference_hint"), true),
      st.loadError ? h("div", { className: "fml-wide fml-error" }, st.loadError) : null,
      Object.keys(st.mapErrors).length ? h("div", { className: "fml-wide fml-error" }, tr("fml.unreadable_files"),
        Object.entries(st.mapErrors).map(([file, message]) => h("div", { key: file }, tr("common.p0_p1", { p0: file, p1: message })))) : null
    ]),
    section("3", "Destination", "fml.destination", [
      field(tr("common.result_destination"), h("select", { value: element.variable ? "variable" : "message", "aria-label": tr("common.result_destination"),
        onChange: e => set("variable", e.target.value === "variable" ? element.variable || "fhirResource" : "") },
        h("option", { value: "message" }, tr("common.outbound_message")), h("option", { value: "variable" }, tr("fml.channel_map_variable")))),
      element.variable ? field(tr("fml.variable"), text("variable", "fhirResource")) : null,
      h("div", { className: "fml-wide" },
        h("div", { className: "fml-row" },
          h("label", null, h("input", { type: "checkbox", checked: validationEnabled,
            onChange: e => set("validationOverride", e.target.checked) }), " ", tr("common.validate_the_result")),
          h("span", { className: "hint" }, tr(hasValidationOverride ? "common.overridden_for_this_step" : "common.inherited_from_the_context")),
          hasValidationOverride ? h("button", { type: "button", className: "btn btn-sm", onClick: () => set("validationOverride", null) }, tr("common.use_context_policy")) : null),
        h("div", { className: "hint" }, tr("common.validates_fhir_output_against_meta_profile"))),
      h("div", { className: "fml-wide" },
        h("label", null, h("input", { type: "checkbox", checked: element.traceMessages === true || element.traceMessages === "true",
          onChange: e => set("traceMessages", e.target.checked) }), " ", tr("fml.trace_this_step")),
        h("div", { className: "hint" }, tr("fml.stores_input_fml_source_parameters_output")))
    ])
  );

  const result = st.result;
  const issues = result?.issues || [];
  const errors = result?.errors || [];
  const validationErrors = issues.filter(i => ["error", "fatal"].includes(i.severity)).length;
  const warnings = issues.filter(i => i.severity === "warning").length;
  const issueCount = validationErrors + warnings;
  const testTabs = [
    { id: "sample", label: tr("common.sample") },
    { id: "source", label: tr("fml.fml_source") },
    { id: "result", label: tr("common.result") },
    { id: "validation", label: issueCount ? tr("common.validation_count", { count: issueCount }) : tr("common.validation") }
  ];
  const testKeys = e => {
    const index = testTabs.findIndex(t => t.id === st.testTab);
    const next = e.key === "ArrowRight" ? (index + 1) % testTabs.length : e.key === "ArrowLeft" ? (index + testTabs.length - 1) % testTabs.length
      : e.key === "Home" ? 0 : e.key === "End" ? testTabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    st.testTab = testTabs[next].id;
    rerender();
    e.currentTarget.querySelectorAll("[role=tab]")[next]?.focus();
  };
  const inputOptions = Object.entries(transformer?.inboundProperties?.serializationProperties || {})
    .filter(([key, value]) => !key.startsWith("@") && value !== null);
  const modelExplanation = {
    "oie-message": "fml.the_plugin_builds_oiemessage_nodes_from",
    "logical": "fml.the_xml_or_json_is_read",
    "fhir": "fml.the_source_structuredefinition_is_resolved_from"
  }[element.sourceModel || "fhir"];
  const referenceVariables = fmlReferenceVariables(element);
  const inputControls = h(React.Fragment, null,
    h("div", { className: "fml-sample-controls" },
      h("label", { htmlFor: "fml-sample-format" }, tr("fml.sample_format")),
      h("select", { id: "fml-sample-format", "aria-label": tr("fml.sample_format"),
        value: prepared ? (st.sample.format === "raw" ? "text" : st.sample.format || "xml") : "channel",
        onChange: e => {
          st.sample.inputMode = e.target.value === "channel" ? "raw" : "prepared";
          if (e.target.value !== "channel") st.sample.format = e.target.value === "text" ? "raw" : e.target.value;
          saveSample(); rerender();
        } },
        h("option", { value: "channel" }, inputLabel),
        h("option", { value: "xml" }, tr("fml.prepared_xml")),
        h("option", { value: "json" }, tr("fml.prepared_json")),
        h("option", { value: "text" }, tr("fml.prepared_text"))),
      !prepared && transformer?.inboundDataType === "HL7V2" ? h("span", { className: "fml-parser-badge" },
        transformer.inboundProperties?.serializationProperties?.useStrictParser === true ? tr("fml.strict_parser") : tr("fml.standard_parser")) : null,
      h("label", { className: "fml-format-sample" },
        h("input", { type: "checkbox", checked: !!st.formatSample, "aria-label": tr("common.format"),
          disabled: !["XML", "JSON", "FHIR", "HL7V2"].includes(sampleType),
          onChange: e => { st.formatSample = e.target.checked; st.sampleDisplay = st.formatSample ? formatSample(st.sample.message, sampleType) : null; rerender(); } }), tr("common.format")),
      h(HelpButton, { compact: true, label: "fml.how_is_the_sample_interpreted", sections: [
        { title: "fml.sample_input", lines: [prepared ? "fml.paste_the_message_received_by_this"
          : "fml.summary_parser_settings_are_applied_previous"] },
        { title: "fml.source_model", lines: [modelExplanation] },
        ...(!prepared && inputOptions.length ? [{ title: "fml.parser_settings", lines: inputOptions.map(([key, value]) =>
          [key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()), typeof value === "object" ? JSON.stringify(value) : String(value)]) }] : [])
      ], note: "fml.formatting_changes_the_display_only_previous" })),
    !prepared && !supported ? h("div", { className: "fml-error" }, tr("fml.the_transformer_datatype_is_unavailable_or")) : null,
    referenceVariables.length ? h("details", { className: "fml-test-variables",
      open: st.testVariablesOpen ?? referenceVariables.some(name => !String(st.sample.variables?.[name] || "").trim()),
      onToggle: e => { st.testVariablesOpen = e.currentTarget.open; } },
      h("summary", null, tr("fml.test_variables"), " (", referenceVariables.length, ") ",
        h(HelpButton, { compact: true, label: "fml.test_variables", sections: [
          { title: "fml.test_variables", lines: ["fml.test_variables_hint"] }
        ] })),
      referenceVariables.map(name => h("label", { key: name }, name,
        h("input", { type: "text", "aria-label": name, value: st.sample.variables?.[name] || "",
          onChange: e => { st.sample.variables = { ...st.sample.variables, [name]: e.target.value }; saveSample(); rerender(); } })))) : null);
  const test = h("div", { className: "fml-test" },
    h("div", { className: "fml-test-actions" },
    h("div", { className: "fml-tabs fml-test-tabs", role: "tablist", "aria-label": tr("common.test_contents"), onKeyDown: testKeys }, testTabs.map(t =>
      h("button", { key: t.id, id: `fml-test-tab-${t.id}`, type: "button", role: "tab", "aria-selected": t.id === st.testTab,
        "aria-controls": `fml-test-panel-${t.id}`, tabIndex: t.id === st.testTab ? 0 : -1,
        className: t.id === "validation" ? validationErrors ? "fml-error" : warnings ? "fml-issue-warning" : "" : "",
        onClick: () => { st.testTab = t.id; rerender(); } }, t.label))),
      h("button", { type: "button", className: "btn btn-primary", disabled: st.testing || !(element.mapUrl || inline) || (!prepared && !supported), onClick: runTest }, st.testing ? tr("common.running") : tr("common.run_test"))),
    h("div", { className: "fml-test-status", role: "status", "aria-live": "polite" },
      result && st.testedInput !== testInput() ? h("div", { className: "fml-issue-warning" }, tr("common.run_again_to_update_the_result")) : null,
      errors.map((e, i) => h("div", { key: i, className: "fml-error" }, tr("common.p0_p1", { p0: e.phase, p1: e.message }))),
      result?.resolvedReferences && referenceVariables.length ? h("details", { className: "fml-resolved-references" },
        h("summary", null, tr("fml.resolved_references")),
        Object.entries(result.resolvedReferences).filter(([, value]) => value).map(([key, value]) =>
          h("div", { key }, h("strong", null, key === "mapUrl" ? tr("common.map") : tr("fml.logical_model_url")), ": ", h("code", null, value)))) : null),

    testTabs.map(t => h("div", { key: t.id, id: `fml-test-panel-${t.id}`, role: "tabpanel", "aria-labelledby": `fml-test-tab-${t.id}`,
      hidden: t.id !== st.testTab, tabIndex: 0, className: "fml-test-panel" + (t.id === "result" ? " fml-test-result" : t.id === "validation" ? " fml-test-validation" : "") },
      t.id === "sample" ? h(React.Fragment, null, inputControls, h(CodeBox, { value: displayedSample, language: languageOf(sampleType), height: "100%", label: tr("common.sample_message"),
        onChange: text => { if (text !== displayedSample) { st.sample.message = text; st.sampleDisplay = st.formatSample ? text : null; saveSample(); rerender(); } } }))
      : t.id === "source" ? result?.model
        ? h(CodeBox, { value: pretty(result.model), language: "json", readOnly: true, height: "100%", label: tr("fml.source_instance_received_by_the_map") })
        : h("div", { className: "hint" }, tr("fml.run_the_test_to_inspect_the"))
      : t.id === "result" ? result?.output
        ? h(React.Fragment, null,
          h("div", { className: "fml-ok" }, tr("common.transformation_succeeded")),
          h(CodeBox, { value: pretty(result.output), language: "json", readOnly: true, height: "100%", label: tr("common.result") }))
        : h("div", { className: "hint" }, tr("common.run_test_to_see_result"))
      : !result ? h("div", { className: "hint" }, tr("common.run_test_to_see_validation"))
      : h(React.Fragment, null,
        h("div", { className: validationErrors ? "fml-error" : warnings ? "fml-issue-warning" : result.validationPerformed ? "fml-ok" : "hint" },
          !result.validationPerformed ? tr("fml.fhir_validation_not_performed")
            : issueCount ? tr("common.validation_errors_error_s_warnings_warning", { errors: validationErrors, warnings }) : tr("common.valid")),
        issues.map((i, n) => h("div", { key: n, className: i.severity === "warning" ? "fml-issue-warning" : ["error", "fatal"].includes(i.severity) ? "fml-error" : "hint" },
          tr("common.p0_p1_p2", { p0: i.severity, p1: i.location || "", p2: i.message }))))))
  );

  // Full screen as in the Mapper Transform: a style of the editor's own element.
  React.useEffect(() => {
    if (!st.fullScreen) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) { st.fullScreen = false; rerender(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [st.fullScreen]);
  const tabs = [{ id: "settings", label: tr("common.properties"), panel: settings }, { id: "map", label: tr("common.map"), panel: mapPanel }, { id: "test", label: tr("common.test"), panel: test }];
  const current = tabs.find((t) => t.id === st.tab) || tabs[0];
  return h(
    "div",
    { className: "fhir-fml fml-layout" + (st.fullScreen ? " mapper-fullscreen" : "") + (current.id === "test" ? " fml-testing-layout" : "") },
    h("div", { className: "fml-tabs", role: "tablist" }, tabs.map((t) =>
      h("button", { key: t.id, type: "button", role: "tab", "aria-selected": t.id === current.id, onClick: () => { st.tab = t.id; rerender(); } }, t.label)),
      h("span", { style: { marginLeft: "auto", alignSelf: "center", marginRight: "6px", display: "inline-flex" } }, h(HelpButton, { key: current.id, ...(FML_HELP[current.id] || FML_HELP.settings) })),
      h("button", { type: "button", className: "btn btn-sm", style: { alignSelf: "center" }, title: tr("common.edit_this_step_on_the_whole"),
        onClick: () => { st.fullScreen = !st.fullScreen; rerender(); } }, st.fullScreen ? tr("common.exit_full_screen_esc") : tr("common.full_screen"))),
    h("div", { key: current.id, role: "tabpanel" }, current.panel)
  );
}

export function register(platform) {
  React = platform.React;
  registerLanguage("fml", FML_LANGUAGE, platform);
  try {
    if (platform.oie && platform.oie.STEP_TYPES && !platform.oie.STEP_TYPES[FML_TYPE]) platform.oie.STEP_TYPES[FML_TYPE] = { label: "FHIR FML Transform" };
  } catch {
    // an administrator without that list: the class name is shown
  }
  platform.registerStepType(FML_TYPE, {
    label: "FHIR FML Transform",
    create: () => ({
      __type: FML_TYPE,
      name: "",
      enabled: true,
      fhirVersion: "R4",
      profiles: "",
      mapUrl: "",
      mapSource: "",
      sourceModel: "fhir",
      context: "",
      variable: "",
      validateOutput: true,
      validationOverride: null,
      traceMessages: false,
      sampleMessage: "",
      sampleFormat: "",
      sampleVariables: "",
      contextVariables: "",
      terminologyServer: "", terminologyAuthorization: "", cacheSeconds: 300, timeoutSeconds: 10
    }),
    validate: (el) => {
      if (!String(el.mapUrl || "").trim() && !String(el.mapSource || "").trim()) return tr("fml.write_the_map_in_the_map");
      if (el.variable !== undefined && el.variable !== "" && !String(el.variable).trim()) return tr("fml.give_the_channel_map_variable_a");
      return "";
    },
    component: FmlTransformEditor
  });
}
