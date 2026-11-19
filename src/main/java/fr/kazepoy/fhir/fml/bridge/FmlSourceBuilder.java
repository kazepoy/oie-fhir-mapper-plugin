/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.fml.bridge;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import org.hl7.fhir.r5.context.IWorkerContext;
import org.hl7.fhir.r5.elementmodel.Element;
import org.hl7.fhir.r5.elementmodel.Manager;
import org.hl7.fhir.r5.elementmodel.Manager.FhirFormat;
import org.hl7.fhir.r5.elementmodel.XmlParser;
import org.hl7.fhir.r5.elementmodel.JsonParser;
import org.hl7.fhir.r5.elementmodel.ParserBase;
import org.hl7.fhir.r5.model.StructureDefinition;

/** Builds the source instance selected by an FML step. */
final class FmlSourceBuilder {
    static final String SOURCE_MODEL = "sourceModel";
    static final String SOURCE_MODEL_URL = "sourceModelUrl";

    private FmlSourceBuilder() {}

    static Element build(IWorkerContext worker, String source, String format, Map<String, String> messageContext,
            Map<String, String> variables, Map<String, String> options) throws Exception {
        String model = text(options.get(SOURCE_MODEL));
        if (model.isEmpty() || "oie-message".equals(model))
            return new OieModelBuilder(worker).build(source, format, messageContext, variables);
        if ("logical".equals(model)) {
            if (!java.util.List.of("xml", "json").contains(text(format).toLowerCase()))
                throw new IllegalArgumentException("The logical source model requires prepared XML or JSON.");
            String url = text(options.get(SOURCE_MODEL_URL));
            if (url.isEmpty()) throw new IllegalArgumentException("The logical source model requires sourceModelUrl.");
            StructureDefinition definition = FmlBridge.fetchStructureDefinition(worker, url);
            if (definition == null) throw new IllegalArgumentException("The logical source model " + url + " is not loaded.");
            ParserBase parser = "json".equalsIgnoreCase(text(format)) ? new JsonParser(worker) : new XmlParser(worker);
            parser.setLogical(definition);
            return parser.parseSingle(new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)), null);
        }
        if ("fhir".equals(model)) {
            FhirFormat input = "xml".equalsIgnoreCase(text(format)) ? FhirFormat.XML : FhirFormat.JSON;
            return Manager.parseSingle(worker, new ByteArrayInputStream(text(source).getBytes(StandardCharsets.UTF_8)), input);
        }
        throw new IllegalArgumentException("Unsupported FML source model " + model + ".");
    }

    private static String text(String value) { return value == null ? "" : value.trim(); }
}
