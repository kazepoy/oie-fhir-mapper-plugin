// SPDX-License-Identifier: MPL-2.0
import { t as tr, localePreference, setLocalePreference } from "../i18n/index.js";
// Settings › FHIR Mapper: the FHIR contexts of the server. A context names a set of
// profile packages, a terminology server and a validation policy; the FHIR steps
// that name it share them. Participates in Web Admin's Settings task pane and dirty tracking.
import { ContextFields } from "./context-fields.js";
import { platform, toast } from "../host/platform.js";
import { loadFhirSettings, saveFhirSettings } from "../host/settings.js";
import { HelpButton } from "../host/help.js";
import { SETTINGS_HELP } from "../host/help-texts.js";

const emptyContext = () => ({ name: "", fhirVersion: "R4", packages: [], terminologyServer: "", terminologyAuthorization: "", cacheSeconds: 300, timeoutSeconds: 10, validation: "always", timeZone: "", timePrecision: "minutes", ambiguousTime: "error" });
const normalizeContexts = list => (list || []).map(c => ({ ...emptyContext(), ...c }));
const serializeContexts = list => JSON.stringify(list || []);

function errorText(e) {
  const m = /<detailMessage>([\s\S]*?)<\/detailMessage>/.exec((e && e.body) || "");
  return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : (e && e.message) || String(e);
}

export function FhirSettingsPanel({ platform: host, setTasks, setSave, markDirty, markClean } = {}) {
  const p = host || platform();
  const React = p.React;
  const h = React.createElement;
  const [contexts, setContexts] = React.useState(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [langPref, setLangPref] = React.useState(localePreference());
  const contextsRef = React.useRef(null);
  contextsRef.current = contexts;
  const cleanRef = React.useRef(null);
  const busyRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  const load = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError("");
    try {
      const s = await loadFhirSettings(true);
      if (!mountedRef.current) return;
      const next = normalizeContexts(s.contexts);
      cleanRef.current = serializeContexts(next);
      contextsRef.current = next;
      setContexts(next);
      markClean?.();
    } catch (e) {
      if (!mountedRef.current) return;
      if (!contextsRef.current) {
        cleanRef.current = serializeContexts([]);
        setContexts([]);
      }
      setError(errorText(e));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  const save = async () => {
    if (!contextsRef.current || busyRef.current) return false;
    busyRef.current = true;
    setSaving(true);
    setError("");
    const submitted = serializeContexts(contextsRef.current);
    try {
      const saved = await saveFhirSettings({ contexts: contextsRef.current });
      if (!mountedRef.current) return false;
      const canonical = normalizeContexts(saved.contexts);
      cleanRef.current = serializeContexts(canonical);
      toast(tr("settings.fhir_contexts_saved_redeploy_the_channels"), "info");
      if (serializeContexts(contextsRef.current) !== submitted) {
        markDirty?.();
        return false;
      }
      contextsRef.current = canonical;
      setContexts(canonical);
      markClean?.();
      return true;
    } catch (e) {
      if (!mountedRef.current) return false;
      setError(/Manage FHIR mapper settings|403/.test(errorText(e)) || e?.status === 403
        ? tr("settings.changing_the_fhir_contexts_requires_the") : errorText(e));
      return false;
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const loadRef = React.useRef(load);
  loadRef.current = load;
  const saveRef = React.useRef(save);
  saveRef.current = save;

  React.useEffect(() => {
    mountedRef.current = true;
    loadRef.current();
    setSave?.(() => saveRef.current());
    return () => {
      mountedRef.current = false;
      setSave?.(null);
    };
  }, []);

  const ready = contexts !== null;
  React.useEffect(() => {
    if (!setTasks || !p.ui?.taskButton) return;
    setTasks(tr("settings.fhir_mapper_tasks"), [
      p.ui.taskButton(tr("common.refresh"), "refresh", () => loadRef.current(), { disabled: loading || saving }),
      p.ui.taskButton(tr("settings.save"), "save", () => saveRef.current(), { primary: true, disabled: loading || saving || !ready })
    ]);
  }, [loading, saving, ready, langPref]);

  React.useEffect(() => {
    if (!contexts || cleanRef.current == null) return;
    if (serializeContexts(contexts) === cleanRef.current) markClean?.();
    else markDirty?.();
  }, [contexts]);

  if (!contexts) return h("div", { className: "hint" }, tr("common.loading"));
  const update = (index, patch) => setContexts(contexts.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const field = (label, control, hint) => h("div", { className: "field" }, h("label", null, label), control, hint ? h("div", { className: "hint" }, hint) : null);
  return h("div", { className: "fhir-mapper-settings" },
    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "8px", flexWrap: "wrap" } },
      h("button", { type: "button", className: "btn", onClick: () => setContexts([emptyContext(), ...contexts]) }, tr("settings.new_context")),
      h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" } },
        h("label", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" } },
          tr("settings.language"),
          h("select", {
            "aria-label": tr("settings.language"),
            value: langPref,
            onChange: e => {
              setLocalePreference(e.target.value);
              setLangPref(localePreference());
            }
          },
            h("option", { value: "auto" }, tr("settings.browser_language")),
            h("option", { value: "en" }, "English"),
            h("option", { value: "fr" }, "Français"))),
        h(HelpButton, SETTINGS_HELP))),
    h("p", { className: "hint" }, tr("settings.a_fhir_context_is_a_named")),
    error ? h("div", { className: "hint", role: "alert", style: { color: "var(--err, #b91c1c)", marginBottom: "8px" } }, error) : null,
    contexts.map((c, i) => h("div", { key: i, className: "panel", style: { marginBottom: "12px" }, "data-context": c.name },
      h("div", { className: "panel-header", style: { display: "flex", alignItems: "center", gap: "8px" } }, c.name || tr("settings.new_context"),
        h("button", { type: "button", className: "btn btn-sm btn-danger", style: { marginLeft: "auto" }, onClick: () => setContexts(contexts.filter((_, n) => n !== i)) }, tr("settings.delete"))),
      h("div", { className: "panel-body" },
        field(tr("common.name"), h("input", { type: "text", value: c.name, placeholder: "labo", "aria-label": tr("settings.context_name"), onChange: e => update(i, { name: e.target.value }) }), tr("settings.letters_digits_steps_refer_to_this")),
        h(ContextFields, { value: c, onChange: patch => update(i, patch) })))));
}
