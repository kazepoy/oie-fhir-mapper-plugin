// SPDX-License-Identifier: MPL-2.0
import { t as tr } from "../i18n/index.js";
// Presentation only: mapping edits and selection remain owned by the editor.
export function Inspector({ h, node, helpUrl, rules, diagnostics, extensions, onClose }) {
  if (!node) return null;
  const el = node.el || {};
  const item = (label, value) => value == null || value === "" ? null : h("div", { key: label }, h("dt", null, label), h("dd", null, value));
  return h("div", {
    className: "mapper-inspector-backdrop",
    onClick: (e) => { if (e.target === e.currentTarget) onClose(); }
  },
    h("div", { className: "mapper-inspector", role: "dialog", "aria-modal": "true", tabIndex: -1, "aria-label": tr("common.element_inspector") },
      h("div", { className: "mapper-inspector-head" },
        h("h3", null, node.key),
        h("button", { type: "button", className: "btn btn-sm", "aria-label": tr("mapper.close"), onClick: onClose }, "×")),
      h("dl", null,
        item(tr("mapper.type"), (node.types || el.type || []).map(type => type.code).join(" | ") || node.code),
        item(tr("mapper.cardinality"), `${node.min ?? el.min ?? 0}..${node.max ?? el.max ?? "*"}`),
        item(tr("mapper.must_support"), node.mustSupport || el.mustSupport ? tr("common.yes") : tr("common.no")),
        item(tr("mapper.slice"), node.sliceName || el.sliceName),
        item(tr("mapper.description"), node.short || el.short),
        item(tr("mapper.definition"), el.definition),
        item(tr("mapper.binding"), node.binding ? `${node.binding.strength}: ${node.binding.valueSet}` : null),
        item(node.fixed?.kind === "pattern" ? tr("mapper.pattern") : tr("mapper.fixed_value"), node.fixed ? JSON.stringify(node.fixed.value) : null)),
      (el.example || []).map((example, index) => h("p", { key: index },
        h("strong", null, example.label || tr("mapper.example")), ": ", JSON.stringify(Object.entries(example).find(([key]) => key.startsWith("value"))?.[1]))),
      h("a", { href: helpUrl, target: "_blank", rel: "noopener noreferrer" }, tr("mapper.official_fhir_definition")),
      extensions,
      rules ? h("section", { "aria-label": tr("mapper.rules") }, h("h4", null, tr("mapper.rules")), rules) : null,
      h("h4", null, tr("mapper.diagnostics")), diagnostics.length ? diagnostics : h("p", { className: "hint" }, tr("mapper.no_diagnostic_reported_for_this_element"))));
}
