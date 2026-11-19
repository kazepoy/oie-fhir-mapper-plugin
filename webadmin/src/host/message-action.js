// SPDX-License-Identifier: MPL-2.0
import { t as tr } from "../i18n/index.js";
// "FHIR mapping trace" on a message of the message browser: shows the traces the
// FHIR Mapper Transform steps left in the connector maps of that message.
import { platform, toast } from "./platform.js";
import { findTraces, traceText } from "../trace/message-trace.js";

export function registerTraceAction() {
  const p = platform();
  if (typeof p.registerMessageAction !== "function") return;
  p.registerMessageAction({
    id: "fhir-mapper-trace",
    label: tr("host.fhir_mapping_trace"),
    order: 50,
    onInvoke: async (message, ctx) => {
      let traces = findTraces(ctx?.connectorMessage || null);
      if (!traces.length) traces = findTraces(message);
      if (!traces.length && ctx?.channelId != null && message?.messageId != null) {
        // The list may hold the message without its maps: read it whole.
        try {
          traces = findTraces(await p.api.get(`/channels/${encodeURIComponent(ctx.channelId)}/messages/${encodeURIComponent(message.messageId)}`));
        } catch { /* reported below */ }
      }
      if (!traces.length) {
        toast(tr("host.this_message_has_no_fhir_mapping"), "info");
        return;
      }
      p.ui.detailModal({
        title: tr("host.fhir_mapping_trace_of_message_p0", { p0: message?.messageId ?? "" }),
        meta: traces.map(t => t.key).join(", "),
        sections: traces.flatMap(({ key, trace }) => [{ label: key, text: traceText(trace) }, { label: tr("host.p0_json", { p0: key }), text: JSON.stringify(trace, null, 2) }])
      });
    }
  });
}
