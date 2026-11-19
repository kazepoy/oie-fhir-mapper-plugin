// SPDX-License-Identifier: MPL-2.0
import { importMappingTable, mappingTable, mappingDocumentation } from "../fhir/mapping-table.js";
import { t as tr } from "../i18n/index.js";
import { React, h, bindReact } from "../host/react.js";
import { ExpressionField, setExpressionFunctions } from "./expression.js";
import { completionContext as mapperCompletionContext } from "../fhir/completion.js";
import { sdKey, sdLoaded, shortType, makeTree, instancesOf, parseMappings, compile, completeness } from "../fhir/model.js";
import { mapperSourcePaths, mapperHelpUrl, mapperJsonImport, mapperRuleKey, mapperRuleIds, MAPPER_TYPE } from "../fhir/step.js";
import { inserted, asBool, fixedText, TRANSLATABLE, isLocalServer, substitute } from "../fhir/expressions.js";
import { fetchSd, fetchElements } from "../host/catalog.js";
import { mapperContext, mapperBundleDeclarations, mapperSample, mapperPreviewSteps } from "../host/channel-context.js";
import { mapperDiagnostic, traceRows as mapperTraceRows, traceExport as mapperTraceExport } from "../fhir/diagnostics.js";
import { snapshot, restore } from "../fhir/history.js";
import { CodeBox, languageOf } from "../host/code-box.js";
import { HelpButton } from "../host/help.js";
import { MAPPER_HELP } from "../host/help-texts.js";
import { cachedFhirSettings, fhirContext, loadFhirSettings } from "../host/settings.js";
import { ContextFields } from "../settings/context-fields.js";
import { normalizeResult } from "../fhir/diagnostics.js";
import { sourceTree, sourcePaths } from "../fhir/source.js";
import { createDiff } from "../host/code-editor.js";
import { Inspector } from "./inspector.js";
import { duplicateBranch, inBranch } from "../fhir/branch.js";
import { matchingConceptMaps, profileExtensions } from "../fhir/assistance.js";
import { showContextMenu } from "../host/context-menu.js";
import { formatSample } from "../fml/sample-format.js";
import { MAPPER_API, mapperFunctions } from "../host/api.js";


// ---------------------------------------------------------------------------------------------
// FHIR Mapper Transform transformer step (FhirMapperTransformStep). The tree of the target profile is
// built from its snapshot (GET /api/extensions/fhir-mapper/structure); data types and extension
// profiles without children in the snapshot are loaded when they are opened. Every element can get
// a JavaScript expression, usually a path in msg (drag it from the Message Trees panel). The step is
// saved with the compiled mappings, so the server needs no profile to generate the script.
// ---------------------------------------------------------------------------------------------

/** A side-by-side diff of the expected and the actual result (the host's diff editor). */
function ResultDiff({ expected, actual }) {
  const host = React.useRef(null);
  React.useEffect(() => {
    const diff = createDiff(expected, actual, "json");
    diff.el.style.height = "320px";
    host.current.appendChild(diff.el);
    diff.layout?.();
    return () => { try { diff.dispose(); } catch { /* already gone */ } diff.el.remove(); };
  }, [expected, actual]);
  return h("div", { ref: host, className: "mapper-result-diff", style: { height: "320px", border: "1px solid #cbd5e1", borderRadius: "4px", overflow: "hidden" } });
}

/** The samples saved with a step: [{ id, name, dataType, message, expected }]. */
function stepSamples(element) {
  return parseMappings(element.samples).filter((s) => s && typeof s === "object" && s.id);
}

/** Whether a test result is what the sample expects; null without an expectation. */
function sampleVerdict(sample, result) {
  if (!sample || sample.expected == null || sample.expected === "") return null;
  return !result.errors.length && normalizeResult(result.output) === normalizeResult(sample.expected);
}

/** The message of a failed request: the engine answers a ClientException as XStream XML. */
function errorText(e) {
  const body = (e && e.body) || "";
  const m = /<detailMessage>([\s\S]*?)<\/detailMessage>/.exec(body);
  if (m) return m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return (e && e.message) || String(e);
}

function downloadMapperTrace(trace) {
  const url = URL.createObjectURL(new Blob([mapperTraceExport(trace)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `fhir-mapper-trace-${trace.id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MapperTransformEditor({ element, onChange, platform }) {
  const [, rerender] = React.useReducer((x) => x + 1, 0);
  const tabId = React.useId();
  const state = React.useRef(null);
  if (state.current === null) {
    const saved = parseMappings(element.mappings);
    const values = new Map();
    const iterations = new Map();
    const translations = new Map();
    const conditions = new Map();
    for (const e of saved) {
      const key = e.key || e.element;
      if (!key) continue;
      if (typeof e.each === "string") iterations.set(key, { expression: e.each, variable: e.variable || "item" });
      else if (typeof e.condition === "string") conditions.set(key, e.condition);
      else if (typeof e.expression === "string") values.set(key, e.expression);
      if (e.translate && typeof e.translate === "object") translations.set(key, { ...e.translate });
    }
    const initial = mapperSample(platform, element);
    let sample = initial.sample;
    try {
      sample = JSON.parse(localStorage.getItem(initial.key) || "null") || sample;
    } catch {
      // no storage: use this transformer's inbound template
    }
    // Samples saved with the step come first: they are the same for every user of the channel.
    const savedSamples = stepSamples(element);
    if (savedSamples.length) sample = { message: savedSamples[0].message, dataType: savedSamples[0].dataType || "HL7V2" };
    state.current = {
      values,
      iterations,
      translations,
      conditions,
      notes: new Map(saved.filter((rule) => rule.note).map((rule) => [mapperRuleKey(rule), rule.note])),
      disabled: new Set(saved.filter((rule) => rule.disabled).map(mapperRuleKey)),
      ruleIds: new Map(saved.filter(rule => rule.id).map(rule => [mapperRuleKey(rule), rule.id])),
      // shown when something below an extension, modifierExtension or id (that "extensions & ids" shows) is mapped
      showAll: [...values.keys(), ...iterations.keys(), ...conditions.keys()].some((k) => /\.(extension|modifierExtension|id)(\[\d+\])?(\.|$)/.test(k)),
      sample,
      activeSample: savedSamples.length ? savedSamples[0].id : null,
      sampleKey: initial.key,
      previewScope: savedSamples[0]?.scope || "step",
      testResult: null,
      testTab: "sample",
      testedSignature: null,
      formatSample: false,
      sampleDisplay: null,
      formatPrepared: false,
      scriptResult: null,
      scriptSignature: null,
      scriptLoading: false,
      testing: false,
      traceOptions: { enabled: false, captureValues: false, maxEvents: 200 },
      versionNotice: "",
      instances: instancesOf([...values.keys(), ...iterations.keys(), ...translations.keys(), ...conditions.keys()]),
      conceptMaps: null,
      tests: new Map(),
      expanded: new Set(),
      rootIndex: null,
      loadedProfileUrl: element.profileUrl || "",
      loadSeq: 0,
      loading: false,
      error: "",
      unresolved: [],
      notice: "",
      profileList: null,
      sourcePaths: [],
      jsonDraft: "",
      filter: "all",
      search: "",
      undo: [],
      redo: [],
      current: null,
      lastPush: 0,
      // An existing mapping opens on its rules; a new step on its properties.
      settingsReady: !!cachedFhirSettings(),
      tab: saved.length ? "mapper" : "properties"
    };
  }
  const st = state.current;
  React.useEffect(() => {
    let active = true;
    mapperFunctions()
      .then((list) => { setExpressionFunctions(list); if (active) rerender(); })
      .catch((error) => {
        if (active) { st.error = tr("mapper.function_catalogue_p0", { p0: errorText(error) }); rerender(); }
      });
    return () => { active = false; };
  }, []);
  React.useEffect(() => {
    let active = true;
    const sample = { ...st.sample };
    st.sourcePaths = mapperSourcePaths(sample);
    rerender();
    const timer = setTimeout(async () => {
      if (sample.dataType !== "HL7V2" || !sample.message.trim()) return;
      try {
        const text = await platform.api.post(`${MAPPER_API}/source`, JSON.stringify(sample), { contentType: "text/plain", raw: true });
        if (active) { st.serialized = JSON.parse(text); st.sourcePaths = mapperSourcePaths(st.serialized); rerender(); }
      } catch { if (active) { st.sourcePaths = []; rerender(); } }
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [st, st.sample.message, st.sample.dataType]);
  // The FHIR contexts of the server; a step that names one takes its version, packages and terminology server.
  React.useEffect(() => {
    let active = true;
    const done = () => { if (active && !st.settingsReady) { st.settingsReady = true; rerender(); } };
    loadFhirSettings().then(done, done);
    return () => { active = false; };
  }, [st]);
  const shared = fhirContext(element.context);
  const version = shared ? shared.fhirVersion : element.fhirVersion || "R4";
  const profiles = shared ? (shared.packages || []).join(";") : element.profiles || "";
  const txServer = shared ? shared.terminologyServer || "" : element.terminologyServer || "";
  const setContext = (name) => {
    element.context = name;
    element.formatVersion = 2;
    if (name && !element.validation) element.validation = "inherit";
    if (!name && element.validation === "inherit") element.validation = asBool(element.validateOutput, true) ? "always" : "off";
    onChange();
    state.current = null; // the profile and its lists are read again with the context's packages
    rerender();
  };
  const ctx = { version, profiles, instances: st.instances, showAll: st.showAll };
  const tree = st.rootIndex ? makeTree(st.rootIndex, ctx) : null;
  const diagnosticHere = error => !error.step || String(error.step.sequenceNumber) === String(element.sequenceNumber);
  const revealDiagnostic = (error) => {
    if (!diagnosticHere(error)) return;
    const chain = st.rootIndex && makeTree(st.rootIndex, { ...ctx, showAll: true }).chain(error.key);
    if (!chain) {
      st.notice = tr("mapper.the_element_p0_is_not_in", { p0: error.key });
    } else {
      st.showAll = true;
      st.filter = "all";
      st.search = "";
      for (const node of chain.slice(0, -1)) st.expanded.add(node.key);
      st.pendingDiagnostic = { key: error.key, kind: mapperDiagnostic(error).kind };
      st.selectedKey = error.key;
      st.tab = "mapper";
    }
    rerender();
  };
  const diagnosticRef = (key, kind) => (node) => {
    if (node && st.pendingDiagnostic?.key === key && st.pendingDiagnostic.kind === kind) {
      st.pendingDiagnostic = null;
      node.scrollIntoView({ block: "center" });
      node.querySelector("input, textarea")?.focus();
    }
  };
  const diagnosticView = (error, id) => {
    const display = mapperDiagnostic(error);
    return h("div", { key: id, style: { color: "var(--err, #b91c1c)", fontSize: "12px", marginBottom: "6px" } },
      h("strong", null, display.label),
      error.key && tree && diagnosticHere(error) ? h("button", { type: "button", className: "btn btn-sm", style: { marginLeft: "6px" }, onClick: () => revealDiagnostic(error) }, tr("common.go_to_rule")) : null,
      h("div", null, error.message),
      !diagnosticHere(error) ? h("div", null, tr("mapper.this_diagnostic_belongs_to_step_name", { name: error.step.name || error.step.sequenceNumber })) : null,
      display.target ? h("div", { style: { fontFamily: "monospace" } }, tr("mapper.target_p0", { p0: display.target })) : null,
      error.expression ? h("pre", { style: { whiteSpace: "pre-wrap", margin: "4px 0" } }, error.expression) : null);
  };

  const allKeys = () => new Set([...st.values.keys(), ...st.iterations.keys(), ...st.translations.keys(), ...st.conditions.keys()]);
  const forget = (key) => {
    st.values.delete(key);
    st.iterations.delete(key);
    st.translations.delete(key);
    st.conditions.delete(key);
  };
  // Compiled on the whole tree, also what "extensions & ids" hides, so that no mapping is lost.
  const compiled = (index, local) => {
    const previous = parseMappings(element.mappings);
    const ids = st.ruleIds ||= new Map();
    const rules = mapperRuleIds(compile(makeTree(index, { ...local, showAll: true }), st.values, st.iterations, st.translations, st.conditions)
      .map(rule => ids.has(mapperRuleKey(rule)) ? { ...rule, id: ids.get(mapperRuleKey(rule)) } : rule), previous);
    for (const rule of rules) ids.set(mapperRuleKey(rule), rule.id);
    return JSON.stringify(rules.map((rule) => {
      const key = mapperRuleKey(rule);
      return { ...rule, ...(st.notes.get(key) ? { note: st.notes.get(key) } : {}), ...(st.disabled.has(key) ? { disabled: true } : {}) };
    }));
  };

  const save = () => {
    if (!tree) return;
    try {
      element.mappings = compiled(st.rootIndex, ctx);
      st.error = "";
    } catch (error) {
      st.error = errorText(error);
      rerender();
      return;
    }
    // Undo history: one entry per burst of edits (typing in a field is one change).
    const snap = snapshot(st);
    if (st.current && JSON.stringify(snap) !== JSON.stringify(st.current)) {
      if (Date.now() - st.lastPush > 1000) { st.undo.push(st.current); if (st.undo.length > 100) st.undo.shift(); }
      st.lastPush = Date.now();
      st.redo = [];
    }
    st.current = snap;
    onChange();
  };
  const importTable = async () => {
    try {
      if (!tree) throw new Error(tr("mapper.load_a_profile_before_importing_a"));
      const file = await platform.ui.pickFile(".csv,.md");
      if (!file) return;
      const edits = importMappingTable(file.content, file.name.toLowerCase().endsWith(".csv") ? "csv" : "markdown",
        makeTree(st.rootIndex, { ...ctx, showAll: true }), element);
      for (const edit of edits) {
        st.values.set(edit.key, edit.expression);
        if (edit.note) st.notes.set(`value:${edit.key}`, edit.note); else st.notes.delete(`value:${edit.key}`);
      }
      st.lastPush = 0;
      save();
      st.lastPush = 0;
      st.notice = tr("mapper.imported_count_value_edit_s", { count: edits.length });
      rerender();
    } catch (error) { st.notice = errorText(error); rerender(); }
  };
  const exportTable = async (format, documentation = false) => {
    try {
      const rules = parseMappings(element.mappings);
      const extension = format === "markdown" ? "md" : format;
      await platform.ui.saveFile(`fhir-mapping.${extension}`, format === "html" ? "text/html" : format === "csv" ? "text/csv" : "text/markdown",
        async () => documentation ? mappingDocumentation(element, rules, format) : mappingTable(rules, format));
    } catch (error) { st.notice = errorText(error); rerender(); }
  };
  const travel = (from, to) => {
    if (!from.length || !tree) return;
    to.push(st.current || snapshot(st));
    st.current = from.pop();
    restore(st, st.current);
    st.lastPush = 0;
    element.mappings = compiled(st.rootIndex, { ...ctx, instances: st.instances });
    onChange();
    rerender();
  };
  // Full screen is a style of the editor's own element: moving it out of the React root would cut its events.
  const toggleFullScreen = () => { st.fullScreen = !st.fullScreen; rerender(); };
  React.useEffect(() => {
    if (!st.fullScreen) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".suggest-widget.visible, .mapper-expression-editing, [role=menu]")) return;
      st.fullScreen = false;
      rerender();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [st.fullScreen]);
  React.useEffect(() => {
    if (!st.inspectorOpen || typeof document === "undefined") return undefined;
    const previousFocus = document.activeElement;
    const dialog = document.querySelector(".mapper-inspector[role=dialog]");
    if (dialog && !dialog.contains(previousFocus)) {
      (dialog.querySelector("button, [href], input, select, textarea") || dialog).focus?.();
    }
    const onKey = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        st.inspectorOpen = false;
        rerender();
        return;
      }
      if (e.key === "Tab" && dialog) {
        const focusable = [...dialog.querySelectorAll("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previousFocus && typeof previousFocus.focus === "function" && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, [st.inspectorOpen]);

  // Loads the profile, then every type on the way to a saved mapping. Mappings of elements another
  // profile does not have are dropped (and listed); for the saved profile, a mapping that cannot be
  // found (a type that failed to load) blocks editing, so that saving cannot lose it.
  const load = async (url) => {
    const reqId = (st.loadSeq = (st.loadSeq || 0) + 1);
    st.loading = true;
    st.error = "";
    st.notice = "";
    st.unresolved = [];
    rerender();
    try {
      const index = await fetchElements(platform, version, profiles, url);
      if (state.current !== st || st.loadSeq !== reqId) return;
      const sameProfile = (st.loadedProfileUrl ?? element.profileUrl) === url && element.resourceType === index.sd.type;
      st.rootIndex = index;
      st.loadedProfileUrl = url;
      if (element.action && index.sd.type === "Bundle") {
        element.action = "createBundle";
        element.bundleTargets = "[]";
        const fixedType = index.byId.get("Bundle.type")?.fixedCode;
        if (fixedType) element.bundleType = fixedType;
      }
      st.expanded.add(index.sd.type);
      const local = { version, profiles, instances: st.instances, showAll: true };
      const unresolved = [];
      for (const key of allKeys()) {
        const parts = key.split(".");
        let found = true;
        for (let i = 1; i <= parts.length && found; i++) {
          const prefix = parts.slice(0, i).join(".");
          let t = makeTree(index, local);
          let nodes = t.chain(prefix);
          if (!nodes) {
            // the parent may be a type that is not loaded yet
            const parentNodes = t.chain(parts.slice(0, i - 1).join("."));
            const parent = parentNodes && parentNodes[parentNodes.length - 1];
            if (parent && parent.typeUrl) {
              await fetchSd(platform, version, profiles, parent.typeUrl);
              if (state.current !== st || st.loadSeq !== reqId) return;
              t = makeTree(index, local);
              nodes = t.chain(prefix);
            }
          }
          if (!nodes) found = false;
          else if (i < parts.length) st.expanded.add(prefix);
        }
        if (!found) unresolved.push(key);
      }
      // Load the types of required elements below what is mapped, so that their fixed values are known.
      for (let round = 0; round < 4; round++) {
        const t = makeTree(index, local);
        const urls = new Set();
        const walk = (node, depth) => {
          for (const d of t.children(node) || []) {
            if (Number(d.min) < 1 || d.instance) continue;
            const kids = t.children(d);
            if (kids === null && d.typeUrl) urls.add(d.typeUrl);
            else if (kids && depth < 6) walk(d, depth + 1);
          }
        };
        for (const key of allKeys()) {
          const nodes = t.chain(key);
          if (nodes) for (const n of nodes.slice(0, -1)) walk(n, 0);
        }
        if (!urls.size) break;
        await Promise.all([...urls].map((u) => fetchSd(platform, version, profiles, u).catch(() => null)));
        if (state.current !== st || st.loadSeq !== reqId) return;
      }
      const sdVersion = index.sd.version || "";
      if (sameProfile && element.profileVersion && sdVersion && element.profileVersion !== sdVersion) {
        st.versionNotice = tr("mapper.the_profile_is_now_version_p0", { p0: sdVersion, p1: element.profileVersion });
      }
      if (sameProfile) {
        st.unresolved = unresolved;
        const before = parseMappings(element.mappings).filter((e) => "fixed" in e).length;
        const now = compiled(index, local);
        if (!unresolved.length && JSON.parse(now).filter((e) => "fixed" in e).length > before) {
          element.mappings = now;
          st.notice = tr("mapper.fixed_values_of_required_elements_were");
          onChange();
        }
      } else {
        for (const key of unresolved) forget(key);
        if (unresolved.length) st.notice = tr("mapper.not_in_this_profile_removed_p0", { p0: unresolved.join(", ") });
      }
      if (!sameProfile) {
        element.profileUrl = url;
        element.profileVersion = index.sd.version || "";
        element.resourceType = index.sd.type;
        element.mappings = compiled(index, local);
        onChange();
      }
    } catch (e) {
      if (state.current !== st || st.loadSeq !== reqId) return;
      st.error = errorText(e);
    } finally {
      if (state.current === st && st.loadSeq === reqId) {
        st.loading = false;
        st.current = snapshot(st);
        rerender();
      }
    }
  };

  React.useEffect(() => {
    // A step that names a context waits for the settings: its packages come from them.
    if (element.profileUrl && (!element.context || st.settingsReady)) load(element.profileUrl);
  }, [st, element.context ? st.settingsReady : true]);

  // The transformer editor shows element.script in its Generated Script tab and validates it with
  // Validate Step: the server's script, as a property that is not enumerable, so never saved.
  const scriptFor = React.useRef({ source: null, timer: null });
  React.useEffect(() => {
    const source = JSON.stringify(element);
    if (source === scriptFor.current.source) return undefined;
    clearTimeout(scriptFor.current.timer);
    scriptFor.current.timer = setTimeout(async () => {
      try {
        const text = await platform.api.post(`${MAPPER_API}/script`, source, { contentType: "text/plain", raw: true });
        const result = JSON.parse(text);
        const errors = (result.errors || []).map((e) => `// ${e.key ? `${e.key}: ` : ""}${e.message}`).join("\n");
        Object.defineProperty(element, "script", { value: (errors ? errors + "\n" : "") + (result.script || ""), enumerable: false, writable: true, configurable: true });
        scriptFor.current.source = source;
      } catch {
        // no preview until the next change
      }
    }, 800);
    return undefined;
  });
  React.useEffect(() => () => clearTimeout(scriptFor.current.timer), []);

  const loadProfileList = async () => {
    try {
      const text = await platform.api.get(`${MAPPER_API}/profiles`, { fhirVersion: version, profiles }, { raw: true });
      st.profileList = JSON.parse(text);
      st.error = "";
    } catch (e) {
      st.error = errorText(e);
    }
    rerender();
  };

  const toggle = async (node) => {
    if (st.expanded.has(node.key)) {
      st.expanded.delete(node.key);
      rerender();
      return;
    }
    st.expanded.add(node.key);
    rerender();
    if (tree.children(node) === null) {
      try {
        await fetchSd(platform, version, profiles, node.typeUrl);
      } catch (e) {
        st.error = tr("common.p0_p1", { p0: node.typeUrl, p1: errorText(e) });
      }
      rerender();
    }
  };

  const setValue = (node, value) => {
    if (value.trim() === "") st.values.delete(node.key);
    else st.values.set(node.key, value);
    save();
    rerender();
  };

  const addInstance = (node) => {
    st.instances.set(node.keyBase, Math.max(1, st.instances.get(node.keyBase) || 1) + 1);
    rerender();
  };

  const duplicate = (node) => {
    const count = tree.children(node.parent).filter(sibling => sibling.keyBase === node.keyBase).length;
    if (!node.repeats || st.iterations.has(node.key) || (node.max !== "*" && count >= Number(node.max))) return;
    const target = `${node.keyBase}[${count}]`;
    duplicateBranch(st, node.key, target);
    st.instances.set(node.keyBase, count + 1);
    st.expanded.add(target);
    st.selectedKey = target;
    st.lastPush = 0;
    save();
    st.lastPush = 0;
    rerender();
  };

  const removeInstance = (node) => {
    for (const key of allKeys()) {
      if (key === node.key || key.startsWith(node.key + ".")) forget(key);
    }
    st.instances.set(node.keyBase, node.instance);
    save();
    rerender();
  };

  const removeUnresolved = () => {
    for (const key of st.unresolved) forget(key);
    st.unresolved = [];
    save();
    rerender();
  };

  const toggleIteration = (node) => {
    if (st.iterations.has(node.key)) st.iterations.delete(node.key);
    else st.iterations.set(node.key, { expression: "", variable: "item" });
    save();
    rerender();
  };
  const setIteration = (node, prop, value) => {
    st.iterations.get(node.key)[prop] = value;
    save();
    rerender();
  };
  const toggleCondition = (node) => {
    if (st.conditions.has(node.key)) st.conditions.delete(node.key);
    else st.conditions.set(node.key, "");
    save();
    rerender();
  };
  const setCondition = (node, value) => {
    st.conditions.set(node.key, value);
    save();
    rerender();
  };
  const saveSample = () => {
    try {
      localStorage.setItem(st.sampleKey, JSON.stringify(st.sample));
    } catch {
      // no storage: the sample is kept while the editor is open
    }
  };
  const previewSelection = scope => {
    if (scope !== "transformer") return { step: { ...element, samples: "[]" } };
    const steps = mapperPreviewSteps(platform, element);
    if (!steps) throw new Error(tr("mapper.the_current_transformer_cannot_be_identified"));
    return { steps };
  };
  // Samples stay in the channel; the test API receives only code and one input message.
  const testOn = async (sample, trace, scope = sample.scope || st.previewScope) => {
    try {
      const text = await platform.api.post(`${MAPPER_API}/test`, JSON.stringify({ ...previewSelection(scope), message: sample.message, dataType: sample.dataType || "HL7V2", trace }), {
        contentType: "text/plain",
        raw: true,
        timeoutMs: 60000
      });
      return JSON.parse(text);
    } catch (e) {
      const message = errorText(e);
      return { output: null, issues: [], errors: [{ key: null, line: null, message: e?.status === 403 || /Test FHIR mapper steps/.test(message)
        ? tr("mapper.testing_a_step_runs_its_code")
        : message }] };
    }
  };
  const testSignature = () => JSON.stringify({
    message: st.sample.message,
    dataType: st.sample.dataType,
    scope: st.previewScope,
    mappings: element.mappings || ""
  });
  const runTest = async () => {
    const sig = testSignature();
    st.testing = true;
    st.testResult = null;
    st.suite = null;
    rerender();
    st.testResult = await testOn(st.sample, st.traceOptions, st.previewScope);
    st.testedSignature = sig;
    const issues = st.testResult?.issues || [];
    const hasValidationErrors = issues.some((i) => ["error", "fatal"].includes(i.severity))
      || (st.testResult?.errors || []).some((e) => e.phase === "validation");
    if (hasValidationErrors) st.testTab = "validation";
    else if (st.testResult?.output !== null && st.testResult?.output !== undefined && st.testTab === "sample" && sig === testSignature()) st.testTab = "result";
    st.testing = false;
    rerender();
  };
  // Samples saved with the step (and so with the channel), each with an optional expected result.
  const samples = stepSamples(element);
  const activeSample = samples.find((s) => s.id === st.activeSample) || null;
  const writeSamples = (next) => { element.samples = JSON.stringify(next); onChange(); rerender(); };
  const updateActive = (patch) => { if (activeSample) writeSamples(samples.map((s) => (s.id === activeSample.id ? { ...s, ...patch } : s))); };
  const selectSample = (id) => {
    st.activeSample = id || null;
    const chosen = samples.find((s) => s.id === id);
    if (chosen) { st.sample = { message: chosen.message, dataType: chosen.dataType || "HL7V2" }; st.previewScope = chosen.scope || "step"; }
    st.sampleDisplay = null;
    st.testResult = null;
    rerender();
  };
  const saveAsSample = async () => {
    const ask = platform.ui?.promptDialog;
    const name = ask ? await ask(tr("mapper.save_the_sample_with_the_step"), tr("common.name"), tr("mapper.sample_count", { count: samples.length + 1 })) : tr("mapper.sample_count", { count: samples.length + 1 });
    if (!name || !String(name).trim()) return;
    const id = crypto.randomUUID();
    st.activeSample = id;
    writeSamples([...samples, { id, name: String(name).trim(), dataType: st.sample.dataType, message: st.sample.message, scope: st.previewScope, expected: null }]);
  };
  const runAllSamples = async () => {
    st.testing = true;
    st.suite = [];
    st.testResult = null;
    rerender();
    for (const sample of samples) {
      const result = await testOn(sample, { enabled: false }, sample.scope || "step");
      const verdict = sampleVerdict(sample, result);
      const invalid = result.issues.some((i) => i.severity === "error" || i.severity === "fatal");
      st.suite.push({ id: sample.id, name: sample.name, ok: !result.errors.length && !invalid && verdict !== false,
        detail: result.errors.length ? result.errors[0].message : invalid ? tr("mapper.invalid_fhir_result") : verdict === false ? tr("mapper.suite_differs_from_expected") : verdict === true ? tr("mapper.suite_matches_expected") : tr("mapper.runs_no_expected_result") });
      rerender();
    }
    st.testTab = "result";
    st.testing = false;
    rerender();
  };
  const loadScript = async (force = false) => {
    const sig = JSON.stringify(element);
    if (st.scriptLoading || (!force && st.scriptResult && st.scriptSignature === sig)) return;
    st.scriptLoading = true;
    rerender();
    try {
      const text = await platform.api.post(`${MAPPER_API}/script`, sig, { contentType: "text/plain", raw: true });
      st.scriptResult = JSON.parse(text);
      st.scriptSignature = sig;
    } catch (e) {
      st.scriptResult = { script: "", errors: [{ key: null, line: null, message: errorText(e) }] };
      st.scriptSignature = null;
    }
    st.scriptLoading = false;
    rerender();
  };

  // A field clicked or pasted in below an iteration is rewritten to its variable, as when dragged.
  const withSubstitution = (node, before, after) => {
    const around = iterationsAround(node);
    const ins = around.length ? inserted(before, after) : null;
    if (!ins || !/^msg\[/.test(ins.text)) return after;
    return after.slice(0, ins.start) + substitute(ins.text, around) + after.slice(ins.end);
  };

  const toggleTranslation = (node) => {
    if (st.translations.has(node.key)) st.translations.delete(node.key);
    else st.translations.set(node.key, { conceptMap: "", source: "", target: "", unmapped: "none" });
    save();
    rerender();
  };
  const setTranslation = (node, prop, value) => {
    st.translations.get(node.key)[prop] = value;
    save();
    rerender();
  };
  // The ConceptMaps of the terminology server, or without one (empty or n/a) of the profile packages.
  const loadConceptMaps = async () => {
    const server = txServer.trim();
    const source = `${server}|${profiles}|${version}`;
    if (st.conceptMaps && st.conceptMaps.source === source) return;
    try {
      const text = await platform.api.get(`${MAPPER_API}/conceptMaps`, { server, profiles, fhirVersion: version }, { raw: true });
      st.conceptMaps = { source, list: JSON.parse(text) };
      st.error = "";
    } catch (e) {
      st.conceptMaps = { source, list: [] };
      st.error = errorText(e);
    }
    rerender();
  };
  const testTranslation = async (node) => {
    const t = st.translations.get(node.key);
    const test = st.tests.get(node.key) || {};
    test.result = "…";
    st.tests.set(node.key, test);
    rerender();
    try {
      const text = await platform.api.get(
        `${MAPPER_API}/translate`,
        { server: txServer, profiles, conceptMap: t.conceptMap, system: t.source || "", code: test.code || "", targetSystem: t.target || "", fhirVersion: version },
        { raw: true }
      );
      const match = JSON.parse(text);
      test.result = match ? tr("mapper.to_p0_p1", { p0: [match.system, match.code].filter(Boolean).join("|"), p1: match.display ? ` (${match.display})` : "" }) : tr("mapper.to_no_match_then_the_rule");
    } catch (e) {
      test.result = errorText(e);
    }
    rerender();
  };

  /** The iterations from a node up to the root, innermost first. */
  const iterationsAround = (node) => {
    const list = [];
    for (let n = node; n; n = n.parent) {
      const it = st.iterations.get(n.key);
      if (it) list.push(it);
    }
    return list;
  };
  // Reference names of the other FHIR steps of this transformer, for fhirRef(...).
  const stepRefs = (() => {
    const found = mapperContext(platform, element);
    return found ? found.steps.filter((s, i) => i !== found.index && s.__type === MAPPER_TYPE && String(s.refName || "").trim())
      .map((s) => ({ step: s.name, expression: String(s.refName).trim(), resourceType: s.resourceType })) : [];
  })();
  // The codes of the value set an element is bound to, read from the server the first time its field is edited.
  const bindingCodes = (node) => (node?.binding && (st.codes ||= new Map()).get(node.binding.valueSet)?.codes) || [];
  const ensureCodes = (node) => {
    if (!node?.binding) return;
    const known = (st.codes ||= new Map());
    if (known.has(node.binding.valueSet)) return;
    known.set(node.binding.valueSet, { codes: [] });
    platform.api.get(`${MAPPER_API}/catalog/expand`, { valueSet: node.binding.valueSet, filter: "", fhirVersion: version, profiles }, { raw: true })
      .then((text) => { known.set(node.binding.valueSet, JSON.parse(text)); rerender(); })
      .catch(() => { /* a value set that cannot be expanded here offers no code */ });
  };
  // Paths of the sample that hold a value, in the form the completion compares (double quotes), with that value.
  const valuedPaths = (() => {
    const serialized = st.sample.dataType === "HL7V2" ? st.serialized : st.sample;
    const values = {};
    if (serialized) {
      for (const f of sourcePaths(sourceTree(serialized))) {
        if (f.value !== null && f.value !== "" && f.path !== "msg") values[f.path.replace(/\['((?:[^'\\]|\\.)*)'\]/g, (_, key) => `[${JSON.stringify(key)}]`)] = f.value;
      }
    }
    return values;
  })();
  const completionFor = (node, role = "value") => ({ ...mapperCompletionContext(node, st.iterations, Object.keys(valuedPaths), role), pathValues: valuedPaths, e4x: st.sample.dataType !== "JSON", refs: stepRefs,
    codes: role === "value" ? bindingCodes(node) : [], bindingStrength: node?.binding?.strength });
  // Elements the last test or compilation reported: marked in the tree.
  const errorsByKey = new Map();
  for (const error of [...(st.testResult?.errors || []), ...(st.scriptResult?.errors || [])]) {
    if (error.key && diagnosticHere(error)) errorsByKey.set(error.key, [...(errorsByKey.get(error.key) || []), error.message]);
  }

  const field = (label, control, hint) => h("div", { className: "field" }, h("label", null, label), control, hint ? h("div", { className: "hint" }, hint) : null);
  const text = (prop, placeholder, code) =>
    h(code ? ExpressionField : "input", {
      completionContext: code ? completionFor(tree?.root, "reference") : undefined,
      type: "text",
      placeholder,
      style: code ? { fontFamily: "monospace", fontSize: "12px" } : undefined,
      value: element[prop] ?? "",
      onChange: (e) => {
        element[prop] = e.target.value;
        onChange();
        rerender();
      }
    });

  const hasMappedBelow = (node) => {
    for (const key of allKeys()) if (key === node.key || key.startsWith(node.key + ".") || key.startsWith(node.key + "[")) return true;
    return false;
  };
  const hasDisabledBelow = (node) => {
    if (!st.disabled.size) return false;
    for (const rule of parseMappings(element.mappings)) {
      if (!st.disabled.has(mapperRuleKey(rule))) continue;
      const key = rule.key || rule.element || "";
      if (key === node.key || key.startsWith(node.key + ".") || key.startsWith(node.key + "[")) return true;
    }
    return false;
  };
  const term = (st.search || "").trim().toLowerCase();
  // Extensions and value[x] can reach the entire type graph. Bound the search,
  // check direct children first and stop recursive visits of the same datatype.
  let searchBudget = 2000;
  let searchTruncated = false;
  const searchCache = new Map();
  const matches = (node, depth = 0) => {
    if (node.key.toLowerCase().includes(term)) return true;
    if (depth >= 4) return false;
    const cacheKey = `${depth}:${node.key}`;
    if (searchCache.has(cacheKey)) return searchCache.get(cacheKey);
    const children = tree.children(node) || [];
    if (children.some(child => child.key.toLowerCase().includes(term))) { searchCache.set(cacheKey, true); return true; }
    if (searchBudget-- <= 0) { searchTruncated = true; return false; }
    for (let parent = node.parent; parent; parent = parent.parent) if (node.typeUrl && parent.typeUrl === node.typeUrl) return false;
    const found = children.some(child => matches(child, depth + 1));
    searchCache.set(cacheKey, found);
    return found;
  };
  // Search the selected branch before spending the budget on unrelated datatypes.
  if (term && st.selectedKey && tree) for (const node of (tree.chain(st.selectedKey) || []).slice(1).reverse()) matches(node);
  const opened = (node) => st.expanded.has(node.key) || (!!term && !node.key.toLowerCase().includes(term) && matches(node));
  const visible = (node) => {
    if (element.action === "createBundle" && (node.key === "Bundle.entry" || node.key.startsWith("Bundle.entry."))) return false;
    if (term && !matches(node)) {
      // keep what is below a matching element
      for (let p = node.parent; p; p = p.parent) if (p.depth > 0 && p.key.toLowerCase().includes(term)) return true;
      return false;
    }
    if (st.filter === "mapped") return hasMappedBelow(node);
    if (st.filter === "disabled") return hasDisabledBelow(node);
    if (st.filter === "mustSupport") return node.mustSupport || Number(node.min) >= 1 || hasMappedBelow(node);
    return true;
  };

  const rows = [];
  const rowGroups = [];
  const guides = (node, auxiliary = false) => {
    const levels = [];
    for (let parent = auxiliary ? node : node.parent; parent && parent.depth > 0; parent = parent.parent) levels.push(parent.depth);
    return h("span", { className: "mapper-tree-guides", "aria-hidden": true },
      levels.map((depth) => h("i", { key: depth, style: { left: `${depth * 20 + 11}px` } })),
      levels.length ? h("b", { style: { left: `${(auxiliary ? node.depth + 1 : node.depth) * 20 - 9}px` } }) : null);
  };
  const blocked = st.loading || st.unresolved.length > 0;
  const addNode = (child, list) => {
    if (!visible(child)) return;
    rows.push(row(child, list));
    if (st.iterations.has(child.key)) rows.push(iterationRow(child));
    if (st.conditions.has(child.key)) rows.push(conditionRow(child));
    if (st.translations.has(child.key)) rows.push(translationRow(child));
    if (opened(child)) addRows(child);
  };
  const addRows = (node) => {
    const list = tree.children(node);
    if (list === null) {
      rows.push(h("tr", { key: node.key + "/loading" }, h("td", { colSpan: 3, style: { paddingLeft: `${(node.depth + 1) * 20 + 26}px` } }, guides(node, true), h("span", { className: "text-text-faint" }, tr("common.loading")))));
      return;
    }
    for (const child of list) {
      addNode(child, list);
    }
  };
  const row = (node, siblings) => {
    const open = opened(node);
    const canExpand = tree.expandable(node);
    const count = siblings.filter((s) => s.keyBase === node.keyBase).length;
    const iterated = st.iterations.has(node.key);
    const canAdd = !iterated && node.repeats && node.instance === count - 1 && (node.max === "*" || Number(node.max) > count);
    const canIterate = node.repeats && !node.choice;
    const canTranslate = !node.choice && TRANSLATABLE.has(node.code);
    const value = st.values.get(node.key) ?? "";
    const types = node.types.map((t) => shortType(t.code) + (t.profile ? ` (${t.profile.map((p) => p.slice(p.lastIndexOf("/") + 1)).join(", ")})` : "")).join(" | ");
    const placeholder = node.fixed ? `${node.fixed.kind}: ${fixedText(node.fixed)}` : node.choice ? tr("mapper.choose_a_type_below")
      : node.binding ? tr("mapper.strength_binding_valueset", { strength: node.binding.strength, valueSet: node.binding.valueSet.replace(/\|.*$/, "").split("/").pop() }) : "";
    const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
    const tool = (label, title, onClick, active) =>
      h("button", { type: "button", className: "btn btn-sm", style: { flex: "none", padding: "0 6px", fontWeight: active ? 700 : 400, borderColor: active ? "var(--accent, #2563eb)" : undefined }, title, disabled: blocked, onClick }, label);
    // Fixed column widths (see the table): the element and type are cut with an ellipsis, the
    // mapping keeps its room, and the actions sit next to it, where they cannot push it away.
    return h(
      "tr",
      { key: node.key, className: [open ? "mapper-node-open" : "", errorsByKey.has(node.key) ? "mapper-node-error" : "", st.selectedKey === node.key ? "mapper-node-selected" : "", rowDisabled(node) ? "mapper-node-disabled" : ""].filter(Boolean).join(" ") || undefined, "data-depth": node.depth, ref: diagnosticRef(node.key, "value"),
        onFocus: () => selectNode(node), onClick: () => selectNode(node),
        onContextMenu: event => nodeMenu(event, node), onKeyDown: event => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) nodeMenu(event, node); },
        title: errorsByKey.has(node.key) ? tr("common.p0_p1", { p0: node.key, p1: errorsByKey.get(node.key).join(" · ") }) : node.short ? tr("common.p0_p1", { p0: node.key, p1: node.short }) : node.key },
      h(
        "td",
        { style: { paddingLeft: `${node.depth * 20}px` } },
        guides(node),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "4px", minWidth: 0 } },
          h(
            "button",
            {
              type: "button",
              className: "mapper-toggle",
              "aria-expanded": canExpand ? open : undefined,
              "aria-label": tr("mapper.format_space", { p0: open ? "Collapse" : "Expand", p1: node.key }),
              style: { visibility: canExpand ? "visible" : "hidden" },
              onClick: () => toggle(node)
            },
            h("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
              h("path", { d: "M9 6l6 6-6 6" }))
          ),
          h("button", { type: "button", className: "mapper-node-label mapper-select", "aria-label": tr("mapper.inspect_p0", { p0: node.key }), "aria-pressed": st.selectedKey === node.key,
            style: { ...ellipsis, minWidth: 0, fontWeight: node.mustSupport || open ? 600 : 400 }, onClick: () => selectNode(node) }, node.label + (node.instance ? ` [${node.instance}]` : "")),
          h("span", { className: "text-text-faint", style: { flex: "none", fontSize: "11px" } }, tr("mapper.format_range", { p0: node.min ?? 0, p1: node.max ?? "*" })),
          node.mustSupport ? h("span", { title: tr("mapper.must_support"), style: { flex: "none", color: "var(--warn, #c2410c)", fontSize: "11px" } }, tr("common.s")) : null,
          h("button", { type: "button", className: "mapper-help",
            title: tr("mapper.official_fhir_definition"), "aria-label": tr("mapper.fhir_help_for_p0", { p0: node.key }),
            onClick: () => { st.selectedKey = node.key; st.inspectorOpen = true; rerender(); } }, "?")
        )
      ),
      h("td", { className: "text-text-faint", style: { ...ellipsis, fontSize: "11px" }, title: types }, types),
      h(
        "td",
        null,
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "4px", minWidth: 0 } },
          node.choice
            ? h("span", { className: "text-text-faint", style: { ...ellipsis, flex: "1 1 auto", fontSize: "11px" } }, placeholder)
            : h(ExpressionField, {
                errors: errorsByKey.get(node.key),
                onEdit: () => ensureCodes(node),
                completionContext: completionFor(node),
                type: "text",
                value,
                disabled: blocked || (element.action === "createBundle" && node.key === "Bundle.type"),
                placeholder,
                title: value || placeholder,
                style: { flex: "1 1 auto", width: "auto", minWidth: "160px", fontFamily: "monospace", fontSize: "12px" },
                onChange: (e) => setValue(node, withSubstitution(node, value, e.target.value)),
                onDrop: (e) => {
                  const dropped = e.dataTransfer && e.dataTransfer.getData("text/plain");
                  const around = iterationsAround(node);
                  if (!dropped || !around.length) return;
                  e.preventDefault();
                  const input = e.target;
                  const start = input.selectionStart ?? input.value.length;
                  const end = input.selectionEnd ?? start;
                  setValue(node, input.value.slice(0, start) + substitute(dropped, around) + input.value.slice(end));
                }
              }),
          canAdd ? tool("+", tr("mapper.add_an_entry"), () => addInstance(node), false) : null,
          node.instance && node.instance === count - 1 ? tool("−", tr("mapper.remove_this_entry_and_its_mappings"), () => removeInstance(node), false) : null,
          canIterate ? tool("↻", tr("mapper.one_entry_for_each_item_of"), () => toggleIteration(node), iterated) : null,
          canTranslate ? tool("⇄", tr("mapper.translate_the_value_with_conceptmap_translate"), () => toggleTranslation(node), st.translations.has(node.key)) : null,
          node.choice ? null : tool("?", tr("mapper.only_map_this_element_and_what"), () => toggleCondition(node), st.conditions.has(node.key)),
          menuButton(node)
        )
      )
    );
  };

  const subRow = (node, suffix, children) =>
    h("tr", { key: `${node.key}/${suffix}`, ref: diagnosticRef(node.key, suffix), "data-owner": node.key }, h("td", { colSpan: 3, style: { paddingLeft: `${node.depth * 20 + 34}px` } }, guides(node, true), h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } }, children)));
  const mono = { fontFamily: "monospace", fontSize: "12px" };

  const rulesAt = (node) => parseMappings(element.mappings).filter((rule) => (rule.key || rule.element) === node.key);
  const rowDisabled = (node) => { const r = st.disabled.size ? rulesAt(node) : []; return r.length > 0 && r.every((rule) => st.disabled.has(mapperRuleKey(rule))); };
  const selectNode = (node) => { if (st.selectedKey !== node.key) { st.selectedKey = node.key; rerender(); } };
  const ruleDetailsFields = (node) => {
    const list = rulesAt(node);
    if (!list.length) return null;
    return h("div", { className: "mapper-inspector-rules" }, list.map((rule) => {
      const key = mapperRuleKey(rule);
      const kind = "each" in rule ? tr("mapper.iteration") : "condition" in rule ? tr("mapper.condition") : "fixed" in rule ? tr("mapper.fixed_value") : tr("mapper.value");
      return h("div", { key, style: { padding: "4px 0" } },
        h("label", null, h("input", {
          type: "checkbox", checked: !st.disabled.has(key), disabled: blocked,
          "aria-label": tr("mapper.enable_p0_rule_for_p1", { p0: kind.toLowerCase(), p1: node.key }),
          onChange: (e) => { if (e.target.checked) st.disabled.delete(key); else st.disabled.add(key); st.lastPush = 0; save(); st.lastPush = 0; rerender(); }
        }), tr("mapper.p0_rule", { p0: kind }), st.disabled.has(key) ? tr("mapper.disabled_kept_not_executed") : ""),
        h("textarea", {
          value: st.notes.get(key) || "", disabled: blocked, rows: 2, placeholder: tr("mapper.rule_note"),
          "aria-label": tr("mapper.note_for_p0_rule_for_p1", { p0: kind.toLowerCase(), p1: node.key }),
          style: { display: "block", width: "100%", marginTop: "4px" },
          onChange: (e) => { if (e.target.value) st.notes.set(key, e.target.value); else st.notes.delete(key); save(); rerender(); }
        }));
    }));
  };
  const iterationFields = (node) => {
    const it = st.iterations.get(node.key);
    const variable = (it.variable || "item").trim() || "item";
    return [
      h("span", { key: "l", title: node === tree.root ? tr("mapper.one_resource_for_each_item") : tr("mapper.one_entry_of_this_element_for") }, node === tree.root ? tr("mapper.each_one_resource_for_each") : tr("mapper.each_for_each")),
      h(ExpressionField, { key: "e", completionContext: completionFor(node, "iteration"), value: it.expression, disabled: blocked, placeholder: "msg['PID']['PID.3']", style: { ...mono, flex: "1 1 240px" }, onChange: (e) => setIteration(node, "expression", e.target.value) }),
      h("span", { key: "a" }, tr("common.as")),
      h("input", { key: "v", type: "text", value: it.variable, disabled: blocked, style: { ...mono, width: "90px" }, onChange: (e) => setIteration(node, "variable", e.target.value) }),
      h("span", { key: "h", className: "text-text-faint", style: { fontSize: "11px" } }, tr("mapper.below_p0_the_item_p1_index", { p0: variable, p1: variable, p2: variable }))
    ];
  };
  const iterationRow = (node) => subRow(node, "each", iterationFields(node));

  const conditionFields = (node) => [
      h("span", { key: "l", title: tr("mapper.what_is_below_this_element_is") }, node === tree.root ? tr("mapper.only_make_the_resource_if") : tr("mapper.only_if")),
      h(ExpressionField, {
        completionContext: completionFor(node, "condition"),
        key: "c",
        type: "text",
        value: st.conditions.get(node.key) || "",
        disabled: blocked,
        placeholder: st.iterations.has(node.key) ? tr("mapper.example_pid_condition", { p0: (st.iterations.get(node.key).variable || "item").trim() }) : "msg['PID']['PID.8']['PID.8.1'].toString() != ''",
        style: { ...mono, flex: "1 1 300px" },
        onChange: (e) => setCondition(node, withSubstitution(node, st.conditions.get(node.key) || "", e.target.value))
      }),
      h("span", { key: "h", className: "text-text-faint", style: { fontSize: "11px" } }, st.iterations.has(node.key) ? tr("mapper.per_item_keeps_the_items_it") : tr("mapper.false_or_an_error_on_a"))
    ];
  const conditionRow = (node) => subRow(node, "condition", conditionFields(node));

  const translationFields = (node, listId = "fhir-mapper-transform-conceptmaps") => {
    const t = st.translations.get(node.key);
    const test = st.tests.get(node.key) || {};
    const allMaps = st.conceptMaps?.list || [];
    const recommended = matchingConceptMaps(allMaps, { source: t.source, target: t.target, valueSet: node.binding?.valueSet,
      systems: bindingCodes(node).map(code => code.system).filter(Boolean) });
    const maps = st.allConceptMaps ? allMaps : recommended;
    const localTx = isLocalServer(txServer);
    const needsValue = t.unmapped === "fixed" || t.unmapped === "function";
    return [
      h("span", { key: "l", title: localTx ? tr("mapper.conceptmap_translate_locally_on_the_conceptmaps") : tr("mapper.conceptmap_translate_on_the_terminology_server") }, localTx ? tr("mapper.translate_conceptmap_local") : tr("mapper.translate_conceptmap")),
      h("input", {
        key: "m",
        type: "text",
        list: listId,
        value: t.conceptMap,
        disabled: blocked,
        placeholder: tr("mapper.canonical_url_of_the_conceptmap"),
        style: { ...mono, flex: "1 1 220px" },
        "aria-label": tr("mapper.conceptmap_for_p0", { p0: node.key }),
        onFocus: () => { loadConceptMaps(); ensureCodes(node); },
        onChange: (e) => setTranslation(node, "conceptMap", e.target.value)
      }),
      h("datalist", { key: "d", id: listId }, maps.map((m) => h("option", { key: m.url, value: m.url }, m.title || m.name || m.url))),
      h("label", { key: "all", className: "hint" }, h("input", { type: "checkbox", checked: !!st.allConceptMaps,
        onChange: event => { st.allConceptMaps = event.target.checked; loadConceptMaps(); rerender(); } }), tr("mapper.all_conceptmaps_p0_matching", { p0: recommended.length })),
      h("input", { key: "s", type: "text", value: t.source, disabled: blocked, placeholder: tr("mapper.source_system_optional"), title: tr("mapper.system_of_the_source_code"), style: { ...mono, flex: "1 1 160px" }, onChange: (e) => setTranslation(node, "source", e.target.value) }),
      h("input", { key: "t", type: "text", value: t.target, disabled: blocked, placeholder: tr("mapper.target_system_optional"), title: tr("mapper.targetsystem_of_translate"), style: { ...mono, flex: "1 1 140px" }, onChange: (e) => setTranslation(node, "target", e.target.value) }),
      h(
        "select",
        { key: "u", value: t.unmapped || "none", disabled: blocked, title: tr("mapper.when_translate_gives_no_match"), onChange: (e) => setTranslation(node, "unmapped", e.target.value) },
        h("option", { value: "none" }, tr("mapper.no_match_leave_empty")),
        h("option", { value: "source" }, tr("mapper.no_match_keep_the_source_code")),
        h("option", { value: "fixed" }, tr("mapper.no_match_fixed_value")),
        h("option", { value: "function" }, tr("mapper.no_match_expression")),
        h("option", { value: "error" }, tr("mapper.no_match_error"))
      ),
      node.code === "CodeableConcept"
        ? h(
            "label",
            { key: "k", className: "check", title: tr("mapper.add_the_source_code_as_a") },
            h("input", { type: "checkbox", checked: !!t.keepSource, disabled: blocked, onChange: (e) => setTranslation(node, "keepSource", e.target.checked) }),
            tr("mapper.source_coding")
          )
        : null,
      needsValue
        ? h(t.unmapped === "function" ? ExpressionField : "input", {
            completionContext: t.unmapped === "function" ? completionFor(node, "translation") : undefined,
            key: "f",
            type: "text",
            value: t.value || "",
            disabled: blocked,
            placeholder: t.unmapped === "fixed" ? tr("mapper.code_or_system_code") : "myFunction(code, system)",
            title:
              t.unmapped === "fixed"
                ? tr("mapper.the_value_for_codes_without_a")
                : tr("mapper.javascript_with_code_and_system_the"),
            style: { ...mono, flex: "1 1 180px" },
            onChange: (e) => setTranslation(node, "value", e.target.value)
          })
        : null,
      h("input", {
        key: "c",
        type: "text",
        value: test.code || "",
        placeholder: tr("common.code"),
        title: tr("mapper.a_source_code_to_try"),
        style: { ...mono, width: "70px" },
        onChange: (e) => {
          st.tests.set(node.key, { ...test, code: e.target.value });
          rerender();
        }
      }),
      h("button", { key: "b", type: "button", className: "btn btn-sm", disabled: !t.conceptMap || !test.code, onClick: () => testTranslation(node) }, tr("common.test")),
      test.result ? h("span", { key: "r", className: "text-text-faint", style: { fontSize: "11px" } }, test.result) : null
    ];
  };
  const translationRow = (node) => subRow(node, "translate", translationFields(node));
  const branchRules = node => parseMappings(element.mappings).filter(rule => inBranch(rule.key || rule.element || "", node.key));
  const nodeMenu = (event, node) => {
    selectNode(node);
    const rules = branchRules(node);
    const enable = rules.length > 0 && rules.every(rule => st.disabled.has(mapperRuleKey(rule)));
    const count = node.parent ? tree.children(node.parent)?.filter(sibling => sibling.keyBase === node.keyBase).length : 0;
    const action = (label, onClick, disabled = false) => ({ label, onClick, disabled: blocked || disabled });
    showContextMenu(platform, event, [
      action(tr("mapper.duplicate_branch"), () => duplicate(node), !node.repeats || st.iterations.has(node.key) || !rules.length || (node.max !== "*" && count >= Number(node.max))),
      action(enable ? tr("mapper.enable_branch_rules") : tr("mapper.disable_branch_rules"), () => {
        for (const rule of rules) { const key = mapperRuleKey(rule); if (enable) st.disabled.delete(key); else st.disabled.add(key); }
        st.lastPush = 0; save(); st.lastPush = 0; rerender();
      }, !rules.length),
      action(tr("mapper.copy_branch_as_json"), async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(rules, null, 2)); }
        catch (error) { st.error = errorText(error); rerender(); }
      }, !rules.length),
      action(tr("mapper.clear_branch"), () => {
        for (const key of allKeys()) if (inBranch(key, node.key)) forget(key);
        if (node.instance && node.instance === count - 1) st.instances.set(node.keyBase, node.instance);
        st.lastPush = 0; save(); st.lastPush = 0; rerender();
      }, !rules.length)
    ]);
  };
  const menuButton = node => h("button", { type: "button", className: "btn btn-sm", "aria-label": tr("mapper.actions_for_p0", { p0: node.key }),
    "aria-haspopup": "menu", disabled: blocked || !platform.ui?.contextMenu,
    onClick: event => nodeMenu(event, node) }, "⋯");
  const createBundle = element.action === "createBundle";
  const declarations = mapperBundleDeclarations(platform, element);
  const targets = parseMappings(element.bundleTargets);
  const bundle = createBundle || targets.length > 0;
  const updateTarget = (name, change) => {
    const next = change === null ? targets.filter((t) => t.name !== name) : targets.some((t) => t.name === name)
      ? targets.map((t) => t.name === name ? { ...t, ...change } : t) : [...targets, { name, ...change }];
    element.bundleTargets = JSON.stringify(next);
    onChange();
    rerender();
  };
  if (tree) {
    const rootTool = (label, title, onClick, active) =>
      h("button", { type: "button", className: "btn btn-sm", style: { marginLeft: "6px", padding: "0 6px", fontWeight: active ? 700 : 400, borderColor: active ? "var(--accent, #2563eb)" : undefined }, title, disabled: blocked, onClick }, label);
    rows.push(
      h(
        "tr",
        { key: tree.root.key, ref: diagnosticRef(tree.root.key, "value"), onFocus: () => selectNode(tree.root), onClick: () => selectNode(tree.root),
          onContextMenu: event => nodeMenu(event, tree.root), onKeyDown: event => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) nodeMenu(event, tree.root); } },
        h(
          "td",
          { colSpan: 3 },
          h("button", { type: "button", className: "mapper-node-label mapper-select", "aria-label": tr("mapper.inspect_p0", { p0: tree.root.key }), "aria-pressed": st.selectedKey === tree.root.key, onClick: () => selectNode(tree.root) }, tree.root.label),
          h("button", { type: "button", className: "mapper-help",
            title: tr("mapper.official_fhir_definition"), "aria-label": tr("mapper.fhir_help_for_p0", { p0: tree.root.key }),
            onClick: () => { st.selectedKey = tree.root.key; st.inspectorOpen = true; rerender(); } }, "?"),
          h("span", { className: "text-text-faint", style: { marginLeft: "8px" } }, st.rootIndex.sd.url + (st.rootIndex.sd.version ? ` | ${st.rootIndex.sd.version}` : "")),
          bundle && !createBundle ? rootTool("↻", tr("mapper.one_resource_for_each_item_of"), () => toggleIteration(tree.root), st.iterations.has(tree.root.key)) : null,
          rootTool("?", tr("mapper.only_make_the_resource_when_a"), () => toggleCondition(tree.root), st.conditions.has(tree.root.key)),
          menuButton(tree.root)
        )
      )
    );
    if (st.iterations.has(tree.root.key)) rows.push(iterationRow(tree.root));
    if (st.conditions.has(tree.root.key)) rows.push(conditionRow(tree.root));
    rowGroups.push(h("tbody", { key: "root" }, rows.splice(0)));
    const children = tree.children(tree.root);
    if (children) for (const child of children) {
      if (!visible(child)) continue;
      addNode(child, children);
      const grouped = st.expanded.has(child.key) || st.iterations.has(child.key) || st.conditions.has(child.key) || st.translations.has(child.key);
      rowGroups.push(h("tbody", { key: child.key, className: grouped ? "mapper-branch-open" : undefined, "aria-label": child.key }, rows.splice(0)));
    }
  }
  // Alt+↑/↓ moves between the fields of the tree, Alt+→/← opens or closes the element.
  const treeKeys = (e) => {
    if (!e.altKey || !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const row = e.target.closest?.("tr");
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const toggleButton = row.querySelector("button[aria-label^='Expand '], button[aria-label^='Collapse ']");
      if (toggleButton && (toggleButton.getAttribute("aria-expanded") === "true") === (e.key === "ArrowLeft")) toggleButton.click();
      return;
    }
    const rows = [...row.closest("table").querySelectorAll("tbody tr")].filter((r) => r.querySelector("[role=combobox], .mapper-expression-editing"));
    const next = rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
    next?.querySelector("[role=combobox]")?.focus();
  };
  const check = tree ? completeness(tree, parseMappings(element.mappings)) : { required: [], mustSupport: [] };
  // A Bundle step sets its type; its entries come from the resource steps that select it.
  const entryKey = (k) => k === "Bundle.entry" || k.startsWith("Bundle.entry.") || k.startsWith("Bundle.entry:");
  if (createBundle) {
    check.required = check.required.filter((k) => k !== "Bundle.type" && !entryKey(k));
    check.mustSupport = check.mustSupport.filter((k) => !entryKey(k));
  }
  const entryNote = createBundle && tree
    ? h("div", { className: "hint", style: { marginTop: "6px" } }, tr("mapper.bundle_entry_is_filled_by_the"))
    : null;
  const testResult = st.testResult;

  const profileOptions = (st.profileList || []).map((p) => h("option", { key: p.url, value: p.url }, tr("mapper.format_parens", { p0: p.title || p.name || p.url, p1: p.type })));

  const localContext = {
    fhirVersion: element.fhirVersion || "R4",
    packages: String(element.profiles || "").split(";"),
    validation: element.validation === "off" || element.validateOutput === false || element.validateOutput === "false" ? "off" : "always",
    terminologyServer: element.terminologyServer || "",
    terminologyAuthorization: element.terminologyAuthorization || "",
    cacheSeconds: element.terminologyCacheSeconds ?? 300,
    timeoutSeconds: element.terminologyTimeoutSeconds ?? 10
  };
  const updateLocalContext = (patch) => {
    if (patch.fhirVersion !== undefined) element.fhirVersion = patch.fhirVersion;
    if (patch.packages !== undefined) { element.profiles = patch.packages.join(";"); st.profileList = null; }
    if (patch.validation !== undefined) {
      element.validation = patch.validation;
      element.validateOutput = patch.validation !== "off";
      element.formatVersion = 2;
    }
    if (patch.terminologyServer !== undefined) element.terminologyServer = patch.terminologyServer;
    if (patch.terminologyAuthorization !== undefined) element.terminologyAuthorization = patch.terminologyAuthorization;
    if (patch.cacheSeconds !== undefined) element.terminologyCacheSeconds = patch.cacheSeconds;
    if (patch.timeoutSeconds !== undefined) element.terminologyTimeoutSeconds = patch.timeoutSeconds;
    onChange();
    rerender();
  };
  const section = (number, key, label, body) => h("section", { className: "mapper-property-section", "data-section": key },
    h("h3", null, h("span", { className: "mapper-flow-number" }, number), label),
    h("div", { className: "mapper-property-grid" }, ...body));

  const propertiesPanel = h(
    "div",
    { className: "mapper-properties" },
    h("section", { className: "mapper-context-section" },
      field(tr("common.fhir_context"),
        h("select", { value: element.context || "", "aria-label": tr("common.fhir_context"), onChange: (e) => setContext(e.target.value) },
          h("option", { value: "" }, tr("common.local_context_this_step")),
          (cachedFhirSettings()?.contexts || []).map((c) => h("option", { key: c.name, value: c.name }, tr("common.settings_name", { name: c.name }))),
          element.context && !shared && st.settingsReady ? h("option", { value: element.context }, tr("common.p0_not_defined_on_this_server", { p0: element.context })) : null)),
      !element.context ? h("details", { key: "local", open: true, className: "mapper-context-details" },
        h("summary", null, tr("common.local_context_configuration")),
        h(ContextFields, { value: localContext, onChange: updateLocalContext }))
        : shared ? h(React.Fragment, null,
          h("p", { className: "mapper-context-summary" }, tr("common.version_count_location_s_validation_policy",
            { version, count: shared.packages?.length || 0, policy: shared.validation })),
          h("details", { key: element.context, className: "mapper-context-details" },
            h("summary", null, tr("common.context_details_managed_in_settings")),
            h(ContextFields, { value: shared, disabled: true })))
          : st.settingsReady ? h("p", { className: "mapper-error" }, tr("common.select_a_context_defined_in_settings")) : null),
    section("1", "Target", tr("common.target"), [
      field(tr("mapper.action"), h("select", {
        value: element.action || "",
        onChange: (e) => {
          element.action = e.target.value;
          if (element.action === "resource") element.bundleName = "";
          else element.bundleTargets = "[]";
          onChange();
          if (element.action === "createBundle" && element.resourceType !== "Bundle") {
            element.profileUrl = "Bundle";
            load("Bundle");
          } else rerender();
        }
      },
      h("option", { value: "createBundle" }, tr("common.create_a_bundle")), h("option", { value: "resource" }, tr("common.build_a_resource"))),
      tr("mapper.bundles_are_named_and_created_explicitly")),
      createBundle ? field(tr("mapper.bundle_name"), text("bundleName", "labo"), tr("mapper.internal_name_used_by_resource_steps")) : null,
      h(
        "div",
        { className: "mapper-wide" },
        field(
          tr("common.target_profile"),
          h(
            "div",
            { className: "mapper-actions" },
            h("input", {
              type: "text",
              list: "fhir-mapper-transform-profiles",
              placeholder: tr("mapper.canonical_url_of_the_profile_or"),
              value: element.profileUrl ?? "",
              onFocus: () => {
                if (st.profileList === null && profiles) loadProfileList();
              },
              onChange: (e) => {
                element.profileUrl = e.target.value;
                onChange();
                rerender();
              }
            }),
            h("datalist", { id: "fhir-mapper-transform-profiles" }, profileOptions),
            h("button", { type: "button", className: "btn btn-sm", disabled: st.loading || !element.profileUrl, onClick: () => load(element.profileUrl.trim()) }, st.loading ? tr("common.loading") : tr("mapper.load"))
          ),
          tr("mapper.loading_another_profile_keeps_the_mappings")
        )
      ),
      createBundle ? field(tr("mapper.bundle_type"), h("select", {
        value: element.bundleType || "transaction",
        disabled: !!st.rootIndex?.byId.get("Bundle.type")?.fixedCode,
        onChange: (e) => { element.bundleType = e.target.value; onChange(); rerender(); }
      }, ["transaction", "batch", "collection", "document", "message"].map((v) => h("option", { key: v, value: v }, v))),
      tr("mapper.defines_the_bundle_and_its_entry")) : null,
      !createBundle ? h("section", { className: "mapper-wide bundle-routing", "aria-label": tr("mapper.add_to_bundles") },
        h("div", { className: "bundle-routing-title" }, tr("mapper.add_to_bundles")),
        h("div", { className: "hint" }, tr("mapper.build_this_resource_once_then_add")),
        targets.length ? field(tr("common.reference_name"), text("refName", "'patient'", true), tr("mapper.common_to_the_selected_bundles_fhirref")) : null,
        !declarations.length && !targets.length ? h("div", { className: "hint", style: { marginTop: "8px" } }, tr("mapper.create_a_bundle_earlier_in_this")) : null,
        [...declarations, ...targets.filter((t) => !declarations.some((b) => b.bundleName === t.name)).map((t) => ({ bundleName: t.name }))].map((b) => {
          const target = targets.find((t) => t.name === b.bundleName);
          const request = target && ["transaction", "batch"].includes(b.bundleType);
          return h("div", { key: b.bundleName, className: "bundle-target", "data-bundle": b.bundleName },
            h("label", { className: "bundle-choice" }, h("input", { type: "checkbox", checked: !!target, onChange: (e) => updateTarget(b.bundleName, e.target.checked ? { requestMethod: "POST", requestUrl: "", ifNoneExist: "" } : null) }),
              b.bundleName, h("span", { className: "hint" }, b.bundleType || tr("mapper.not_declared_earlier"))),
            b.name ? h("div", { className: "hint" }, tr("mapper.created_by_step_p0", { p0: b.name })) : null,
            request ? h("div", { className: "bundle-request" },
              field(tr("mapper.method"), h("select", { value: target.requestMethod || "POST", onChange: (e) => updateTarget(b.bundleName, { requestMethod: e.target.value }) },
                ["POST", "PUT", "PATCH", "DELETE", "GET", "HEAD"].map((v) => h("option", { key: v, value: v }, v)))),
              field(tr("mapper.request_url"), h(ExpressionField, { completionContext: completionFor(tree?.root, "reference"), value: target.requestUrl || "", placeholder: tr("mapper.empty_the_resource_type_or_type"), onChange: (e) => updateTarget(b.bundleName, { requestUrl: e.target.value }), style: mono }))) : null,
            request && (!target.requestMethod || target.requestMethod === "POST") ? field(tr("mapper.if_none_exist"), h(ExpressionField, { completionContext: completionFor(tree?.root, "reference"), value: target.ifNoneExist || "", placeholder: "'identifier=' + ...", onChange: (e) => updateTarget(b.bundleName, { ifNoneExist: e.target.value }), style: mono }), tr("mapper.conditional_creation_for_this_bundle_entry")) : null,
            target && !request ? h("div", { className: "hint", style: { marginTop: "8px" } }, b.bundleType ? tr("mapper.no_request_for_a_p0_bundle", { p0: b.bundleType }) : tr("mapper.this_bundle_must_be_created_earlier")) : null
          );
        })
      ) : null
    ]),
    section("2", "Output & validation", tr("mapper.output_validation"), (() => {
      const inheritedValidation = (shared ? shared.validation : localContext.validation) !== "off";
      const validationPolicy = element.validation || (element.context ? "inherit" : (asBool(element.validateOutput, true) ? "always" : "off"));
      const hasValidationOverride = !!element.context && validationPolicy !== "inherit";
      const validationEnabled = hasValidationOverride ? validationPolicy === "always" : inheritedValidation;
      return [
        createBundle || !bundle ? field(tr("common.result_destination"), h("select", {
          value: element.variable ? "variable" : "message",
          onChange: (e) => { element.variable = e.target.value === "variable" ? (element.bundleName ? `bundle_${element.bundleName}` : "resourceResult") : ""; onChange(); rerender(); }
        }, h("option", { value: "message" }, tr("common.outbound_message")), h("option", { value: "variable" }, tr("mapper.channel_map_variable"))),
        createBundle ? tr("mapper.the_completed_bundle_is_published_here") : tr("mapper.destination_of_this_standalone_resource")) : null,
        (createBundle || !bundle) && element.variable ? field(tr("mapper.variable_name"), text("variable", "bundleDocument"), tr("mapper.fhir_json_in_the_channel_map")) : null,
        h("div", { className: "mapper-wide" },
          field(tr("mapper.options"),
            h("div", { className: "mapper-checks" },
              h("label", { className: "check" },
                h("input", {
                  type: "checkbox",
                  checked: asBool(element.addMetaProfile, true),
                  onChange: (e) => { element.addMetaProfile = e.target.checked; onChange(); rerender(); }
                }),
                tr("mapper.add_the_profile_to_meta_profile")),
              h("label", { className: "check" },
                h("input", {
                  type: "checkbox",
                  checked: asBool(element.setLastUpdated, false),
                  onChange: (e) => { element.setLastUpdated = e.target.checked; onChange(); rerender(); }
                }),
                tr("mapper.set_meta_lastupdated"))))),
        h("div", { className: "mapper-wide" },
          h("div", { className: "mapper-actions" },
            h("label", { className: "check" },
              h("input", {
                type: "checkbox",
                "aria-label": tr("common.validation"),
                checked: validationEnabled,
                onChange: (e) => {
                  const next = e.target.checked;
                  element.validation = next ? "always" : "off";
                  element.validateOutput = next;
                  element.formatVersion = 2;
                  onChange();
                  rerender();
                }
              }),
              " ",
              bundle && !createBundle ? tr("mapper.validate_this_preview") : tr("common.validate_the_result")),
            element.context ? h("span", { className: "hint" }, tr(hasValidationOverride ? "common.overridden_for_this_step" : "common.inherited_from_the_context")) : null,
            hasValidationOverride ? h("button", {
              type: "button",
              className: "btn btn-sm",
              onClick: () => {
                element.validation = "inherit";
                element.validateOutput = inheritedValidation;
                element.formatVersion = 2;
                onChange();
                rerender();
              }
            }, tr("common.use_context_policy")) : null),
          h("div", { className: "hint" }, bundle && !createBundle
            ? tr("mapper.final_validation_is_set_on_each")
            : tr("common.validates_fhir_output_against_meta_profile"))),
        h("div", { className: "mapper-wide" },
          h("div", { className: "mapper-checks" },
            h("label", { className: "check" },
              h("input", { type: "checkbox", checked: asBool(element.traceMessages, false),
                onChange: (e) => { element.traceMessages = e.target.checked; if (!e.target.checked) element.traceCaptureValues = false; onChange(); rerender(); } }),
              tr("mapper.trace_processed_messages")),
            h("label", { className: "check", title: tr("mapper.also_record_the_scalar_values_of") },
              h("input", { type: "checkbox", checked: asBool(element.traceCaptureValues, false), disabled: !asBool(element.traceMessages, false),
                onChange: (e) => { element.traceCaptureValues = e.target.checked; onChange(); rerender(); } }),
              tr("mapper.include_scalar_values"))),
          h("div", { className: "hint" }, tr("mapper.each_message_processed_by_the_deployed")))
      ];
    })())
  );

  const tablesAndJsonPanel = h("div", { className: "mapper-tools" },
    h("section", { className: "mapper-tools-card" },
      h("h3", null, tr("mapper.value_tables_documentation")),
      h("p", { className: "mapper-tools-hint" }, tr("mapper.tables_edit_value_expressions_and_notes")),
      h("div", { className: "mapper-tools-groups" },
        h("div", { className: "mapper-tools-group" },
          h("span", { className: "mapper-tools-group-label" }, tr("mapper.value_tables")),
          h("div", { className: "mapper-actions" },
            h("button", { type: "button", className: "btn btn-sm", disabled: !tree, onClick: importTable }, tr("mapper.import_value_table")),
            h("button", { type: "button", className: "btn btn-sm", onClick: () => exportTable("csv") }, tr("mapper.export_csv_table")),
            h("button", { type: "button", className: "btn btn-sm", onClick: () => exportTable("markdown") }, tr("mapper.export_markdown_table")))),
        h("div", { className: "mapper-tools-group" },
          h("span", { className: "mapper-tools-group-label" }, tr("mapper.documentation")),
          h("div", { className: "mapper-actions" },
            h("button", { type: "button", className: "btn btn-sm", onClick: () => exportTable("markdown", true) }, tr("mapper.export_markdown_documentation")),
            h("button", { type: "button", className: "btn btn-sm", onClick: () => exportTable("html", true) }, tr("mapper.export_html_documentation")))))),
    h("details", { open: true, className: "mapper-tools-card mapper-tools-json" },
      h("summary", null, tr("common.edit_as_json")),
      h("div", { className: "mapper-tools-json-body" },
        h("p", { className: "mapper-tools-hint" }, tr("mapper.the_whole_step_properties_and_rules")),
        h("div", { className: "mapper-actions" },
          h("button", { type: "button", className: "btn btn-sm", onClick: () => { st.jsonDraft = JSON.stringify(element, null, 2); rerender(); } }, tr("mapper.read_current_step")),
          h("button", { type: "button", className: "btn btn-sm btn-primary", disabled: st.loading || !st.jsonDraft.trim(), onClick: async () => {
            try {
              const next = mapperJsonImport(element, st.jsonDraft);
              const result = JSON.parse(await platform.api.post(`${MAPPER_API}/script`, JSON.stringify(next), { contentType: "text/plain", raw: true }));
              if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("\n"));
              Object.assign(element, next);
              state.current = null;
              onChange(); rerender();
            } catch (error) { st.error = errorText(error); rerender(); }
          } }, tr("mapper.validate_and_apply"))),
        h(CodeBox, { value: st.jsonDraft, language: "json", height: "320px", label: tr("mapper.step_mapping_json"),
          onChange: (text) => { if (text !== st.jsonDraft) { st.jsonDraft = text; rerender(); } } }),
        h("p", { className: "mapper-tools-hint" }, tr("mapper.applies_to_this_step_only_its"))))
  );
  const messages = h(
    React.Fragment,
    null,
    st.error ? h("div", { className: "hint", style: { color: "var(--err, #b91c1c)", marginTop: "6px" } }, st.error) : null,
    st.notice ? h("div", { className: "hint", style: { color: "var(--warn, #b45309)", marginTop: "6px" } }, st.notice) : null,
    st.versionNotice
      ? h(
          "div",
          { className: "hint", style: { color: "var(--warn, #b45309)", marginTop: "6px" } },
          st.versionNotice + " ",
          h(
            "button",
            {
              type: "button",
              className: "btn btn-sm",
              onClick: () => {
                element.profileVersion = st.rootIndex.sd.version || "";
                st.versionNotice = "";
                onChange();
                rerender();
              }
            },
            tr("mapper.checked")
          )
        )
      : null,
    st.unresolved.length
      ? h(
          "div",
          { className: "hint", style: { color: "var(--warn, #b45309)", marginTop: "6px" } },
          tr("mapper.cannot_find_these_mapped_elements_in", { p0: st.unresolved.join(", ") }),
          h("button", { type: "button", className: "btn btn-sm", onClick: removeUnresolved }, tr("mapper.remove_these_mappings"))
        )
      : null
  );
  const fullTree = tree ? makeTree(st.rootIndex, { ...ctx, showAll: true }) : null;
  const loadExtensions = async () => {
    if (st.extensions) return;
    try {
      const text = await platform.api.get(`${MAPPER_API}/catalog`, { kind: "extension", fhirVersion: version, profiles }, { raw: true });
      if (state.current !== st) return;
      st.extensions = JSON.parse(text);
    } catch (error) { st.error = errorText(error); }
    rerender();
  };
  const addCatalogExtension = async (container, url) => {
    if (!url || blocked) return;
    try {
      const nodes = (fullTree.children(container) || []).filter(node => node.jsonName === "extension" && !node.sliceName && node.max !== "0");
      if (!nodes.length || nodes[0].el.slicing?.rules === "closed") return;
      const node = nodes.find(candidate => ![...allKeys()].some(key => inBranch(key, candidate.key)));
      if (!node && nodes[0].max !== "*" && nodes.length >= Number(nodes[0].max)) throw new Error(tr("mapper.no_extension_occurrence_is_available"));
      if (!sdLoaded.has(sdKey(version, profiles, nodes[0].typeUrl))) await fetchSd(platform, version, profiles, nodes[0].typeUrl);
      if (state.current !== st) return;
      const key = node ? node.key : `${nodes[0].keyBase}[${nodes.length}]`;
      if (!node) st.instances.set(nodes[0].keyBase, nodes.length + 1);
      st.values.set(`${key}.url`, JSON.stringify(url));
      st.showAll = true; st.search = ""; st.filter = "all"; st.inspectorOpen = false;
      st.expanded.add(container.key); st.expanded.add(key); st.selectedKey = key;
      st.lastPush = 0; save(); st.lastPush = 0; rerender();
    } catch (error) { st.error = errorText(error); rerender(); }
  };
  const extensionPanel = node => {
    const declared = profileExtensions(fullTree, node);
    const generic = (fullTree.children(node) || []).find(child => child.jsonName === "extension" && !child.sliceName && child.max !== "0");
    if (!declared.length && !generic) return null;
    const open = generic && generic.el.slicing?.rules !== "closed";
    return h("section", { "aria-label": tr("mapper.extensions") }, h("h4", null, tr("mapper.extensions")),
      declared.length ? h("select", { "aria-label": tr("mapper.profile_extension"), value: "", disabled: blocked,
        onChange: event => { const key = event.target.value; if (key) { st.inspectorOpen = false; revealDiagnostic({ key }); st.expanded.add(key); rerender(); } } },
        h("option", { value: "" }, tr("mapper.choose_an_extension_of_the_profile")),
        declared.map(item => h("option", { key: item.key, value: item.key }, tr("mapper.format_dash", { p0: item.label, p1: item.url })))) : null,
      open ? h("div", null,
        h("button", { type: "button", className: "btn btn-sm", disabled: blocked, onClick: loadExtensions }, tr("mapper.list_context_extensions")),
        st.extensions ? h("select", { "aria-label": tr("mapper.add_context_extension"), value: "", disabled: blocked,
          onChange: event => addCatalogExtension(node, event.target.value) },
          h("option", { value: "" }, st.extensions.length ? tr("mapper.add_an_extension_by_url") : tr("mapper.no_extension_in_this_context")),
          st.extensions.map(item => h("option", { key: item.url, value: item.url }, tr("mapper.format_dash", { p0: item.title || item.name || item.url, p1: item.url })))) : null) : null);
  };
  const selectedChain = fullTree && st.selectedKey ? fullTree.chain(st.selectedKey) : null;
  const selected = selectedChain?.[selectedChain.length - 1];
  const inspector = () => st.inspectorOpen && selected ? h(Inspector, { key: selected.key, h, node: selected,
    extensions: extensionPanel(selected),
    rules: ruleDetailsFields(selected),
    helpUrl: mapperHelpUrl(version, element.resourceType, selected.key),
    diagnostics: [...(st.testResult?.errors || []), ...(st.scriptResult?.errors || [])]
      .filter(error => error.key === selected.key).map((error, index) => diagnosticView(error, index)),
    onClose: () => { st.inspectorOpen = false; rerender(); } }) : null;
  const mapperPanel = tree
      ? h(
          "div",
          { className: "mapper-panel" },
          h(
            "div",
            { className: "mapper-toolbar" },
            h("span", { className: "text-text-faint" }, tr("common.show")),
            h(
              "select",
              {
                value: st.filter,
                onChange: (e) => {
                  st.filter = e.target.value;
                  rerender();
                }
              },
              h("option", { value: "all" }, tr("mapper.all_elements")),
              h("option", { value: "mustSupport" }, tr("mapper.must_support_and_required")),
              h("option", { value: "mapped" }, tr("mapper.mapped_only")),
              h("option", { value: "disabled" }, tr("mapper.disabled_rules"))
            ),
            h(
              "label",
              { className: "check", title: tr("mapper.also_show_extension_modifierextension_and_id") },
              h("input", {
                type: "checkbox",
                checked: st.showAll,
                onChange: (e) => {
                  st.showAll = e.target.checked;
                  rerender();
                }
              }),
              tr("mapper.extensions_ids")
            ),
            h("input", { type: "search", value: st.search || "", placeholder: tr("mapper.search_elements_placeholder"), "aria-label": tr("mapper.search_elements"), style: { width: "180px", flex: "none", height: "26px", minHeight: "26px", padding: "2px 8px" },
              onChange: (e) => { st.search = e.target.value; rerender(); } }),
            h("div", { className: "mapper-toolbar-right" },
              h("button", { type: "button", className: "btn btn-sm", title: tr("mapper.undo_the_last_change_of_the"), disabled: !(st.undo || []).length || blocked, onClick: () => travel(st.undo, st.redo) }, tr("mapper.undo_undo")),
              h("button", { type: "button", className: "btn btn-sm", title: tr("mapper.redo"), disabled: !(st.redo || []).length || blocked, onClick: () => travel(st.redo, st.undo) }, tr("mapper.redo_redo")),
              h("button", { type: "button", className: "btn btn-sm mapper-icon-btn", title: tr("mapper.expand_the_mapped_elements"), "aria-label": tr("mapper.expand_mapped"), onClick: () => {
                for (const key of allKeys()) { const parts = key.split("."); for (let i = 1; i < parts.length; i++) st.expanded.add(parts.slice(0, i).join(".")); }
                rerender(); } },
                h("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
                  h("path", { d: "M7 10l5-5 5 5" }), h("path", { d: "M7 14l5 5 5-5" }))),
              h("button", { type: "button", className: "btn btn-sm mapper-icon-btn", title: tr("mapper.collapse_every_element"), "aria-label": tr("mapper.collapse_all"), onClick: () => { st.expanded = new Set([tree.root.key]); rerender(); } },
                h("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
                  h("path", { d: "M7 5l5 5 5-5" }), h("path", { d: "M7 19l5-5 5 5" }))))
          ),
          check.required.length || check.mustSupport.length
            ? h(
                "div",
                { className: "hint mapper-status" },
                check.required.length ? h("div", { style: { color: "var(--err, #b91c1c)" } }, tr("mapper.required_not_mapped_p0", { p0: check.required.join(", ") })) : null,
                check.mustSupport.length ? h("div", { style: { color: "var(--warn, #b45309)" } }, tr("mapper.must_support_not_mapped_p0", { p0: check.mustSupport.join(", ") })) : null
              )
            : h("div", { className: "hint mapper-status", style: { color: "var(--ok, #15803d)" } }, tr("mapper.every_required_element_below_the_mapped")),
          searchTruncated ? h("p", { className: "hint" }, tr("mapper.search_is_limited_to_part_of")) : null,
          h("div", { className: "mapper-workspace" },
          h(
            "div",
            { className: "dt-wrap border border-line rounded", style: { maxHeight: "none", overflowX: "auto", overflowY: "visible" }, onKeyDownCapture: treeKeys },
            h(
              "table",
              { className: "dt mapper-tree", style: { tableLayout: "fixed", width: "100%", minWidth: "720px" } },
              h("colgroup", null, h("col", { style: { width: "36%" } }), h("col", { style: { width: "14%" } }), h("col", { style: { width: "50%" } })),
              h("thead", null, h("tr", null, h("th", null, tr("common.element")), h("th", null, tr("mapper.type")), h("th", null, tr("mapper.mapping")))),
              rowGroups
            )
          ), inspector()),
          entryNote
        )
      : h("div", { className: "hint" }, st.loading ? tr("mapper.loading_the_target_profile") : tr("mapper.load_a_target_profile_in_properties"));
  const testPanel = (() => {
    if (!tree) return h("div", { className: "hint" }, st.loading ? tr("mapper.loading_the_target_profile") : tr("mapper.load_target_profile_to_test"));
    const issues = testResult?.issues || [];
    const validationErrors = issues.filter((i) => ["error", "fatal"].includes(i.severity)).length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    const issueCount = validationErrors + warnings;
    const testTabs = [
      { id: "sample", label: tr("common.sample") },
      { id: "source", label: tr("mapper.prepared_message") },
      { id: "result", label: tr("common.result") },
      { id: "validation", label: issueCount ? tr("common.validation_count", { count: issueCount }) : tr("common.validation") },
      { id: "trace", label: testResult?.trace ? tr("mapper.trace_count", { count: testResult.trace.events.length }) : tr("common.trace") },
      { id: "script", label: tr("common.generated_script") }
    ];
    const selectTestTab = (id) => {
      st.testTab = id;
      rerender();
      if (id === "script") loadScript();
    };
    const testKeys = (e) => {
      const index = testTabs.findIndex((t) => t.id === st.testTab);
      const next = e.key === "ArrowRight" ? (index + 1) % testTabs.length : e.key === "ArrowLeft" ? (index + testTabs.length - 1) % testTabs.length
        : e.key === "Home" ? 0 : e.key === "End" ? testTabs.length - 1 : -1;
      if (next < 0) return;
      e.preventDefault();
      selectTestTab(testTabs[next].id);
      e.currentTarget.querySelectorAll("[role=tab]")[next]?.focus();
    };
    const canFormat = (dt) => ["XML", "JSON", "FHIR", "HL7V2"].includes(dt);
    const displayedSample = st.formatSample
      ? (st.sampleDisplay ?? (st.sampleDisplay = formatSample(st.sample.message, st.sample.dataType)))
      : st.sample.message;
    const sampleControls = h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "mapper-sample-controls" },
        h(
          "select",
          {
            "aria-label": tr("mapper.data_type"),
            value: st.sample.dataType,
            onChange: (e) => {
              st.sample.dataType = e.target.value;
              st.sampleDisplay = st.formatSample ? formatSample(st.sample.message, st.sample.dataType) : null;
              if (activeSample) updateActive({ dataType: e.target.value }); else saveSample();
              rerender();
            }
          },
          ["HL7V2", "XML", "JSON", "RAW"].map((v) => h("option", { key: v, value: v }, v))
        ),
        h(
          "label",
          null,
          h("input", {
            type: "checkbox",
            checked: !!st.formatSample,
            "aria-label": tr("common.format"),
            disabled: !canFormat(st.sample.dataType),
            onChange: (e) => {
              st.formatSample = e.target.checked;
              st.sampleDisplay = st.formatSample ? formatSample(st.sample.message, st.sample.dataType) : null;
              rerender();
            }
          }),
          tr("common.format")
        ),
        h(
          "select",
          {
            value: activeSample ? activeSample.id : "",
            "aria-label": tr("common.sample"),
            title: tr("mapper.samples_saved_with_the_step"),
            onChange: (e) => selectSample(e.target.value)
          },
          h("option", { value: "" }, tr("mapper.unsaved_sample_this_browser")),
          samples.map((s) => h("option", { key: s.id, value: s.id }, s.name + (s.expected ? " ✓" : "")))
        ),
        h(
          "select",
          {
            value: st.previewScope,
            "aria-label": tr("mapper.preview_scope"),
            disabled: st.testing,
            onChange: (e) => { st.previewScope = e.target.value; st.testResult = null; if (activeSample) updateActive({ scope: st.previewScope }); rerender(); }
          },
          h("option", { value: "step" }, tr("mapper.this_step_only")),
          h("option", { value: "transformer", disabled: !mapperContext(platform, element) }, tr("mapper.mapper_transform_steps_of_this_transformer"))
        ),
        !activeSample ? h("button", { type: "button", className: "btn btn-sm", disabled: !st.sample.message.trim(), title: tr("mapper.keep_this_message_in_the_step"), onClick: saveAsSample }, tr("common.save_as_sample")) : null,
        activeSample ? h("button", { type: "button", className: "btn btn-sm", title: tr("mapper.remove_this_sample_from_the_step"), onClick: () => { st.activeSample = null; writeSamples(samples.filter((s) => s.id !== activeSample.id)); } }, tr("mapper.delete_sample")) : null,
        h("label", null, h("input", { type: "checkbox", checked: st.traceOptions.enabled,
          onChange: (e) => { st.traceOptions.enabled = e.target.checked; if (!e.target.checked) st.traceOptions.captureValues = false; rerender(); } }), tr("mapper.trace")),
        h("label", { title: tr("mapper.explicitly_include_scalar_values_in_the") },
          h("input", { type: "checkbox", checked: st.traceOptions.captureValues, disabled: !st.traceOptions.enabled,
            onChange: (e) => { st.traceOptions.captureValues = e.target.checked; rerender(); } }), tr("mapper.include_scalar_values")),
        h("label", null, tr("mapper.max_events"), h("input", { type: "number", min: 1, max: 1000, value: st.traceOptions.maxEvents,
          disabled: !st.traceOptions.enabled, style: { width: "76px" },
          onChange: (e) => { st.traceOptions.maxEvents = Number(e.target.value); rerender(); } }))
      ),
      h("div", { className: "text-text-faint", style: { fontSize: "11px" } },
        st.previewScope === "transformer" ? tr("mapper.runs_enabled_mapper_transform_steps_in") : tr("mapper.runs_this_step_on_the_server"))
    );

    const renderResultBody = () => {
      if (st.suite) {
        return h("div", { className: "mapper-test-diagnostics", style: { maxHeight: "none" } },
          h("table", { className: "dt", style: { margin: "4px 0", width: "100%" }, "aria-label": tr("mapper.results_of_the_saved_samples") },
            h("tbody", null, st.suite.map((r) => h("tr", { key: r.id, style: { cursor: "pointer" }, onClick: () => selectSample(r.id) },
              h("td", { style: { width: "70px", color: r.ok ? "var(--ok, #15803d)" : "var(--err, #b91c1c)", fontWeight: 600 } }, r.ok ? tr("mapper.passed") : tr("mapper.failed")),
              h("td", null, r.name), h("td", { className: "text-text-faint" }, r.detail))))));
      }
      if (testResult?.output === null || testResult?.output === undefined) {
        return h("div", { className: "hint" }, tr("common.run_test_to_see_result"));
      }
      const verdict = sampleVerdict(activeSample, testResult);
      return h(
        "div",
        { className: "mapper-test-output" },
        h(
          "div",
          { className: "mapper-test-diagnostics" },
          !activeSample ? h("div", { className: "mapper-ok" }, tr("common.transformation_succeeded")) : null,
          activeSample ? h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", margin: "2px 0" } },
            verdict === true ? h("strong", { className: "mapper-ok" }, tr("mapper.matches_the_expected_result")) : null,
            verdict === false ? h("strong", { className: "mapper-error" }, tr("mapper.differs_from_the_expected_result")) : null,
            verdict === null ? h("span", { className: "mapper-ok" }, tr("common.transformation_succeeded")) : null,
            h("button", { type: "button", className: "btn btn-sm", title: tr("mapper.random_identities_urn_uuid_and_meta"), onClick: () => updateActive({ expected: testResult.output }) },
              activeSample.expected ? tr("mapper.replace_the_expected_result_with_this") : tr("common.use_this_result_as_expected")),
            activeSample.expected ? h("button", { type: "button", className: "btn btn-sm", onClick: () => updateActive({ expected: null }) }, tr("mapper.clear_the_expected_result")) : null) : null,
          activeSample && verdict === false
            ? h(ResultDiff, { expected: normalizeResult(activeSample.expected), actual: normalizeResult(testResult.output) }) : null,
          testResult.steps ? h("details", null,
            h("summary", null, tr("mapper.produced_resources_by_step")),
            testResult.steps.map((result, i) => h("details", { key: i },
              h("summary", null, `${result.step.sequenceNumber} · ${result.step.name || result.step.resourceType} (${result.resources.length})`),
              result.resources.map((resource, j) => h("pre", { key: j, style: { maxHeight: "300px", overflow: "auto", whiteSpace: "pre-wrap" } }, prettyJson(resource)))))) : null,
          Object.keys(testResult.variables || {}).length ? h("details", null,
            h("summary", null, tr("mapper.published_channel_variables")),
            Object.entries(testResult.variables).map(([name, value]) => h("details", { key: name }, h("summary", null, name),
              h("pre", { style: { maxHeight: "360px", overflow: "auto", whiteSpace: "pre-wrap" } }, prettyJson(value))))) : null
        ),
        h(CodeBox, { value: prettyJson(testResult.output), language: String(testResult.output).trim().startsWith("<") ? "xml" : "json", readOnly: true, height: "100%", label: tr("common.result") })
      );
    };

    const renderValidationBody = () => {
      if (!testResult) return h("div", { className: "hint" }, tr("common.run_test_to_see_validation"));
      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: validationErrors ? "mapper-error" : warnings ? "mapper-issue-warning" : testResult.validationPerformed !== false ? "mapper-ok" : "hint" },
          testResult.validationPerformed === false ? tr("mapper.fhir_validation_disabled")
            : issueCount ? tr("common.validation_errors_error_s_warnings_warning", { errors: validationErrors, warnings }) : tr("common.valid")
        ),
        issues.map((i, n) => h("div", {
          key: `i${n}`,
          className: i.severity === "warning" ? "mapper-issue-warning" : ["error", "fatal"].includes(i.severity) ? "mapper-error" : "hint",
          style: { fontSize: "12px", fontFamily: "monospace" }
        }, tr("common.p0_p1_p2", { p0: i.severity, p1: i.location || "", p2: i.message })))
      );
    };

    const renderTraceBody = () => {
      if (!testResult?.trace) return h("div", { className: "hint" }, tr("mapper.enable_trace_in_sample_and_run"));
      return h(
        React.Fragment,
        null,
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
          h("strong", null, tr("mapper.execution_trace_p0_event_s_p1", { p0: testResult.trace.events.length, p1: testResult.trace.truncated ? " — truncated" : "" })),
          h("button", { type: "button", className: "btn btn-sm", onClick: () => downloadMapperTrace(testResult.trace) }, tr("mapper.export_trace_json")),
          h("span", { className: "hint" }, testResult.trace.captureValues ? tr("mapper.scalar_values_included") : tr("mapper.runtime_values_not_captured"))),
        h("ol", { style: { overflow: "auto", fontSize: "12px", margin: 0, paddingLeft: "20px" } },
          mapperTraceRows(testResult.trace).map(({ event, label, duration, iterations }, index) =>
            h("li", { key: index, style: { margin: "6px 0" } },
              h("strong", null, tr("mapper.format_dot", { p0: label, p1: event.status })),
              h("span", { style: { marginLeft: "6px" } }, duration),
              event.key && tree && diagnosticHere({ step: testResult.trace.steps?.find((step) => String(step.sequenceNumber) === String(event.step)) || testResult.trace.step })
                ? h("button", { type: "button", className: "btn btn-sm", style: { marginLeft: "6px" }, onClick: () => revealDiagnostic({ ...event, step: testResult.trace.steps?.find((step) => String(step.sequenceNumber) === String(event.step)) || testResult.trace.step }) }, tr("common.go_to_rule")) : null,
              iterations ? h("div", null, iterations) : null,
              event.reason ? h("div", null, event.reason) : null,
              event.count !== undefined ? h("div", null, tr("mapper.p0_item_s", { p0: event.count })) : null,
              event.value ? h("pre", { style: { whiteSpace: "pre-wrap", margin: "4px 0" } }, JSON.stringify(event.value)) : null)))
      );
    };

    const renderScriptBody = () => {
      if (st.scriptLoading && !st.scriptResult) return h("div", { className: "hint" }, tr("mapper.loading_generated_script"));
      return h(
        "div",
        { className: "mapper-test-script" },
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("button", { type: "button", className: "btn btn-sm", disabled: st.scriptLoading, onClick: () => loadScript(true) }, st.scriptLoading ? tr("mapper.loading_generated_script") : tr("common.refresh"))),
        (st.scriptResult?.errors || []).map((e, i) => diagnosticView(e, `s${i}`)),
        h(CodeBox, { value: st.scriptResult?.script || "", language: "javascript", readOnly: true, height: "100%", label: tr("common.generated_script") })
      );
    };

    return h(
      "div",
      { className: "mapper-test" },
      h(
        "div",
        { className: "mapper-test-actions" },
        h(
          "div",
          { className: "mapper-tabs mapper-test-tabs", role: "tablist", "aria-label": tr("common.test_contents"), onKeyDown: testKeys },
          testTabs.map((t) => h("button", {
            key: t.id,
            id: `mapper-test-tab-${t.id}`,
            type: "button",
            role: "tab",
            "aria-selected": t.id === st.testTab,
            "aria-controls": `mapper-test-panel-${t.id}`,
            tabIndex: t.id === st.testTab ? 0 : -1,
            className: t.id === "validation" ? (validationErrors ? "mapper-error" : warnings ? "mapper-issue-warning" : "") : "",
            onClick: () => selectTestTab(t.id)
          }, t.label))
        ),
        samples.length ? h("button", { type: "button", className: "btn btn-sm", disabled: st.testing, title: tr("mapper.run_every_saved_sample_and_compare"), onClick: runAllSamples }, tr("mapper.run_all_p0", { p0: samples.length })) : null,
        h("button", { type: "button", className: "btn btn-primary", disabled: st.testing || !st.sample.message.trim(), onClick: runTest }, st.testing ? tr("common.running") : tr("common.run_test"))
      ),
      h(
        "div",
        { className: "mapper-test-status", role: "status", "aria-live": "polite" },
        testResult && st.testedSignature !== testSignature() ? h("div", { className: "mapper-issue-warning" }, tr("common.run_again_to_update_the_result")) : null,
        (testResult?.errors || []).map((e, i) => diagnosticView(e, `e${i}`))
      ),
      testTabs.map((t) => h(
        "div",
        {
          key: t.id,
          id: `mapper-test-panel-${t.id}`,
          role: "tabpanel",
          "aria-labelledby": `mapper-test-tab-${t.id}`,
          hidden: t.id !== st.testTab,
          tabIndex: 0,
          className: "mapper-test-panel"
            + (t.id === "result" ? " mapper-test-result" : t.id === "validation" ? " mapper-test-validation" : t.id === "trace" ? " mapper-test-trace" : "")
        },
        t.id === "sample" ? h(React.Fragment, null, sampleControls, h(CodeBox, {
          value: displayedSample,
          language: languageOf(st.sample.dataType),
          height: "100%",
          label: tr("common.sample_message"),
          onChange: (text) => {
            if (text === displayedSample) return;
            st.sample.message = text;
            st.sampleDisplay = st.formatSample ? text : null;
            if (activeSample) updateActive({ message: text }); else saveSample();
            rerender();
          }
        }))
        : t.id === "source" ? (testResult?.source
          ? h(React.Fragment, null,
            h("div", { className: "mapper-sample-controls" },
              h("label", null,
                h("input", {
                  type: "checkbox",
                  checked: !!st.formatPrepared,
                  "aria-label": tr("common.format"),
                  disabled: !canFormat(testResult.source.dataType),
                  onChange: (e) => { st.formatPrepared = e.target.checked; rerender(); }
                }),
                tr("common.format"))),
            h(CodeBox, {
              value: st.formatPrepared
                ? formatSample(testResult.source.message, testResult.source.dataType)
                : (testResult.source.dataType === "JSON" ? prettyJson(testResult.source.message) : testResult.source.message),
              language: languageOf(testResult.source.dataType),
              readOnly: true,
              height: "100%",
              label: tr("mapper.prepared_message")
            }))
          : h("div", { className: "hint" }, tr("mapper.run_the_test_to_inspect_the")))
        : t.id === "result" ? renderResultBody()
        : t.id === "validation" ? renderValidationBody()
        : t.id === "trace" ? renderTraceBody()
        : renderScriptBody()
      ))
    );
  })();

  const tabs = [
    { id: "properties", label: tr("common.properties"), panel: propertiesPanel },
    { id: "mapper", label: tr("mapper.mapper"), panel: mapperPanel,
      badge: check.required.length ? { text: String(check.required.length), title: tr("mapper.p0_required_element_s_not_mapped", { p0: check.required.length }) } : null },
    { id: "test", label: tr("common.test"), panel: testPanel,
      badge: testResult?.errors?.length ? { text: "!", title: tr("mapper.the_last_test_failed") } : null },
    { id: "tools", label: tr("mapper.import_export"), panel: tablesAndJsonPanel }
  ];
  const current = tabs.find((t) => t.id === st.tab) || tabs[0];
  const tabKeys = (e) => {
    const index = tabs.indexOf(current);
    const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
      : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    st.tab = tabs[next].id;
    rerender();
    e.currentTarget.querySelectorAll("[role=tab]")[next]?.focus();
  };
  return h(
    "div",
    { className: "fhir-mapper-transform mapper-layout" + (st.fullScreen ? " mapper-fullscreen" : "") + (current.id === "test" && tree ? " mapper-testing-layout" : "") + (current.id === "mapper" && tree ? " mapper-mapping-layout" : "") },
    h("div", { className: "mapper-tabs", role: "tablist", "aria-label": tr("mapper.fhir_mapper_sections"), onKeyDown: tabKeys },
      tabs.map((t) => h("button", {
        key: t.id, id: `${tabId}-${t.id}`, type: "button", role: "tab", "aria-selected": t === current, "aria-controls": `${tabId}-panel`,
        tabIndex: t === current ? 0 : -1, onClick: () => { st.tab = t.id; rerender(); }
      }, t.label, t.badge ? h("span", { className: "mapper-tab-badge", title: t.badge.title }, t.badge.text) : null)),
      h("span", { style: { marginLeft: "auto", alignSelf: "center", marginRight: "6px", display: "inline-flex" } }, h(HelpButton, { key: current.id, ...(MAPPER_HELP[current.id] || MAPPER_HELP.mapper) })),
      h("button", { type: "button", className: "btn btn-sm", style: { alignSelf: "center" }, title: tr("common.edit_this_step_on_the_whole"), onClick: toggleFullScreen },
        st.fullScreen ? tr("common.exit_full_screen_esc") : tr("common.full_screen"))),
    messages,
    h("div", { className: "mapper-tab-panel", id: `${tabId}-panel`, role: "tabpanel", "aria-labelledby": `${tabId}-${current.id}` }, current.panel)
  );
}

function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return String(text);
  }
}

function registerMapperTransform(platform) {
  bindReact(platform.React);
  // The transformer editor names step types from this list (else from the class name).
  try {
    if (platform.oie && platform.oie.STEP_TYPES && !platform.oie.STEP_TYPES[MAPPER_TYPE]) platform.oie.STEP_TYPES[MAPPER_TYPE] = { label: "FHIR Mapper Transform" };
  } catch {
    // an administrator without that list: the class name is shown
  }
  platform.registerStepType(MAPPER_TYPE, {
    label: "FHIR Mapper Transform",
    create: () => ({
      __type: MAPPER_TYPE,
      name: "",
      enabled: true,
      fhirVersion: "R4",
      profiles: "",
      profileUrl: "",
      resourceType: "",
      profileVersion: "",
      addMetaProfile: true,
      validateOutput: true,
      setLastUpdated: false,
      variable: "",
      action: "resource",
      bundleName: "",
      bundleTargets: "[]",
      bundleType: "transaction",
      refName: "",
      terminologyServer: "",
      terminologyAuthorization: "",
      terminologyCacheSeconds: 300,
      terminologyTimeoutSeconds: 10,
      formatVersion: 2,
      context: "",
      validation: "always",
      mappings: "[]",
      samples: "[]",
      traceMessages: false,
      traceCaptureValues: false
    }),
    validate: (el) => {
      if (!["createBundle", "resource"].includes(el.action)) return tr("mapper.choose_the_action_create_a_bundle");
      if (!el.profileUrl || !String(el.profileUrl).trim()) return tr("common.choose_the_target_profile");
      if (!el.resourceType) return tr("mapper.load_the_target_profile");
      if (el.action === "createBundle" && !String(el.bundleName || "").trim()) return tr("mapper.give_the_bundle_a_name");
      if (el.action === "createBundle" && el.resourceType !== "Bundle") return tr("mapper.create_a_bundle_needs_a_bundle");
      const entries = parseMappings(el.mappings);
      const noValue = entries.find((e) => e.translate && (e.translate.unmapped === "fixed" || e.translate.unmapped === "function") && !String(e.translate.value || "").trim());
      if (noValue) return tr("mapper.the_translation_of_p0_needs_a", { p0: noValue.key, p1: noValue.translate.unmapped === "fixed" ? "fixed value" : "expression" });
      const bad = entries.find((e) => typeof e.each === "string" && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(e.variable || ""));
      if (bad) return tr("mapper.the_variable_of_the_iteration_on", { p0: bad.key });
      if (!(el.action === "createBundle" || parseMappings(el.bundleTargets).length) && entries.some((e) => typeof e.each === "string" && Array.isArray(e.path) && !e.path.length))
        return tr("mapper.one_resource_for_each_item_needs");
      return "";
    },
    component: MapperTransformEditor
  });
}

export function register(platform) {
  registerMapperTransform(platform);
}
