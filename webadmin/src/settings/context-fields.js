// SPDX-License-Identifier: MPL-2.0
import { t as tr } from "../i18n/index.js";
import { platform } from "../host/platform.js";

/** Shared context form for Settings and the context local to an FML step. */
export function ContextFields({ value, onChange, disabled = false }) {
  const React = platform().React;
  const h = React.createElement;
  const configured = !!String(value.terminologyServer || value.terminologyAuthorization || "").trim();
  const [open, setOpen] = React.useState(configured);
  React.useEffect(() => { if (configured) setOpen(true); }, [configured]);
  const field = (label, control, hint, wide = false) => h("div", { className: wide ? "field span-2" : "field" },
    h("label", null, tr(label)), control, hint ? h("div", { className: "hint" }, tr(hint)) : null);
  const input = (key, label, type = "text", min) => h("input", { type, min, disabled,
    "aria-label": tr(label), value: value[key] ?? (key === "cacheSeconds" ? 300 : key === "timeoutSeconds" ? 10 : ""),
    onChange: e => onChange({ [key]: type === "number" ? Number(e.target.value) : e.target.value }) });
  return h("div", { className: "form-grid fhir-context-fields" },
    field("settings.fhir_version", h("select", { disabled, value: value.fhirVersion || "R4", "aria-label": tr("settings.fhir_version"),
      onChange: e => onChange({ fhirVersion: e.target.value }) }, ["R4", "R4B", "R5"].map(v => h("option", { key: v, value: v }, v)))),
    field("settings.validation_of_results", h("select", { disabled, value: value.validation || "always", "aria-label": tr("settings.validation_of_results"),
      onChange: e => onChange({ validation: e.target.value }) },
      h("option", { value: "always" }, tr("common.always")), h("option", { value: "off" }, tr("common.off")))),
    field("settings.packages_and_profile_files", h("textarea", { rows: 3, disabled, value: (value.packages || []).join("\n"),
      "aria-label": tr("common.packages"), style: { width: "100%", fontFamily: "monospace" },
      onChange: e => onChange({ packages: e.target.value.split("\n") }) }),
      "settings.one_path_per_line_on_the", true),
    h("details", { className: "span-2 fhir-context-terminology", open, onToggle: e => setOpen(e.currentTarget.open) }, h("summary", null, tr("settings.terminology_server_options")),
      h("div", { className: "form-grid", style: { marginTop: "10px" } },
        field("common.terminology_server", input("terminologyServer", "common.terminology_server"), "settings.base_url_as_the_oie_server"),
        field("settings.authorization", input("terminologyAuthorization", "settings.authorization"), "settings.javascript_expression_of_the_authorization_header"),
        field("settings.cache_seconds", input("cacheSeconds", "settings.cache_seconds", "number", 0)),
        field("settings.timeout_seconds", input("timeoutSeconds", "settings.timeout_seconds", "number", 1)))));
}
