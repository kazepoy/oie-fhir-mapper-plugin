// SPDX-License-Identifier: MPL-2.0
import { t as tr } from "../i18n/index.js";
// A small "?" button that opens a panel of contextual help: titled sections of
// short lines, optionally with a key (a symbol, a button name, a shortcut).
// Closes on Escape, on a click outside, or on the button again.
import { platform } from "./platform.js";

/**
 * @param {{ label: string, sections: { title: string, lines: (string | [string, string])[] }[], note?: string }} props
 */
export function HelpButton({ label, sections, note, compact = false }) {
  const React = platform().React;
  const h = React.createElement;
  const [open, setOpen] = React.useState(false);
  const root = React.useRef(null);
  const panel = React.useRef(null);
  React.useLayoutEffect(() => {
    if (!open || !compact) return undefined;
    const popup = panel.current;
    popup.showPopover();
    const place = () => {
      const anchor = root.current.getBoundingClientRect();
      const box = popup.getBoundingClientRect();
      popup.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)) + "px";
      popup.style.top = (anchor.bottom + box.height + 14 <= window.innerHeight
        ? anchor.bottom + 6 : Math.max(8, anchor.top - box.height - 6)) + "px";
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      popup.hidePopover();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, compact]);
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown, true); document.removeEventListener("keydown", onKey, true); };
  }, [open]);
  return h("span", { ref: root, className: "fm-help" + (compact ? " fm-help--compact" : "") },
    h("button", { type: "button", className: "fm-help__button" + (open ? " fm-help__button--open" : ""), "aria-label": tr(label), title: tr(label), "aria-expanded": open, onClick: () => setOpen(!open) }, compact ? h("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true },
      h("path", { d: "M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 100-20 10 10 0 000 20z" })) : "?"),
    open ? h("div", { ref: panel, popover: compact ? "manual" : undefined, className: "fm-help__panel", role: "dialog", "aria-label": tr(label) },
      sections.map(section => h("section", { key: section.title },
        h("h4", null, tr(section.title)),
        section.lines.map((line, i) => Array.isArray(line)
          ? h("div", { key: i, className: "fm-help__row" }, h("span", { className: "fm-help__key" }, tr(line[0])), h("span", null, tr(line[1])))
          : h("p", { key: i }, tr(line))))),
      note ? h("p", { className: "fm-help__note" }, tr(note)) : null) : null);
}
