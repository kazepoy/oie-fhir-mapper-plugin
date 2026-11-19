// SPDX-License-Identifier: MPL-2.0
/** A readable view of a sample; the caller retains the original test payload. */
export function formatSample(message, dataType) {
  const type = dataType === "FHIR" ? (message.trim().startsWith("<") ? "XML" : "JSON") : dataType;
  try {
    if (type === "JSON") return JSON.stringify(JSON.parse(message), null, 2);
    if (type === "HL7V2") return message.replace(/\r\n?|\n/g, "\n");
    if (type !== "XML") return message;
    const document = new DOMParser().parseFromString(message, "application/xml");
    if (document.querySelector("parsererror") || document.doctype) return message;
    const indent = (element, depth) => {
      const children = [...element.childNodes];
      // Keep leaf values and mixed text/element content intact.
      if (!children.some(node => node.nodeType === 1)
          || children.some(node => node.nodeType === 4 || (node.nodeType === 3 && node.nodeValue.trim()))) return;
      for (const node of children) if (node.nodeType === 3) element.removeChild(node);
      for (const child of [...element.childNodes]) {
        element.insertBefore(document.createTextNode("\n" + "  ".repeat(depth + 1)), child);
        if (child.nodeType === 1) indent(child, depth + 1);
      }
      element.appendChild(document.createTextNode("\n" + "  ".repeat(depth)));
    };
    indent(document.documentElement, 0);
    const declaration = /^\s*(<\?xml[^?]*\?>)/.exec(message)?.[1];
    const serializer = new XMLSerializer();
    const xml = [...document.childNodes]
      .filter(node => node.nodeType !== 7 || node.nodeName.toLowerCase() !== "xml")
      .map(node => serializer.serializeToString(node)).join("\n");
    return (declaration ? declaration + "\n" : "") + xml;

  } catch {
    // Invalid samples remain editable and are still sent unchanged to the tester.
    return message;
  }
}
