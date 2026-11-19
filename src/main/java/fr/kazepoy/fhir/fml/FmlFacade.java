/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.fml;

import java.util.Map;

import fr.kazepoy.fhir.fml.integration.FmlBridgeAdapter;
import fr.kazepoy.fhir.mapper.fhir.FhirValidation;

/**
 * Entry point of the FHIR FML Transform step, for its generated script and its servlet: runs a map
 * through the FML bridge, and validates the result with FHIR Data Type like the Mapper Transform.
 */
public final class FmlFacade {
    /** Prefix of a map reference that carries the FML text of the step, not a canonical URL. */
    public static final String INLINE = "inline:";

    private FmlFacade() {}

    /** The map a step runs: its own text when it has one, else the canonical URL it names. */
    public static String mapReference(String mapSource, String mapUrl) {
        return mapSource != null && !mapSource.isBlank() ? INLINE + mapSource : (mapUrl == null ? "" : mapUrl.trim());
    }

    private static String mapLabel(String reference) {
        return reference != null && reference.startsWith(INLINE) ? "the map written in the step" : "map " + reference;
    }

    /** Parses a map written in a step: {"url", "name", "groups", "errors": [{line, column, message}]}. */
    public static String check(String mapSource, String version, String profiles) throws Exception {
        return FmlBridgeAdapter.check(mapSource, version, profiles);
    }

    /** The maps of the profile locations: {"maps": [{url, name, title}], "errors": {file: message}}. */
    public static String listMaps(String version, String profiles) throws Exception {
        return FmlBridgeAdapter.listMaps(version, profiles);
    }

    public static String mapSource(String url, String version, String profiles) throws Exception {
        return FmlBridgeAdapter.mapSource(url, version, profiles);
    }

    /** The OIE logical model instance a map receives for this message, as JSON. */
    public static String source(String source, String format, Map<String, String> context, Map<String, String> variables,
            String version, String profiles) throws Exception {
        return FmlBridgeAdapter.source(source, format, context, variables, version, profiles, "oie-message", "");
    }

    /**
     * What the deployed step runs: the map, then, if asked, the validation of its result against
     * the profiles it declares (meta.profile) or its base definition. A failure stops the message.
     */
    public static String run(String stepName, String mapUrl, String source, String format, Map<String, String> context,
            Map<String, String> variables, Map<String, String> options, boolean validate, Map<String, Object> trace) throws Exception {
        long started = System.nanoTime();
        String label = "FHIR FML Transform" + (stepName == null || stepName.isBlank() ? "" : " \"" + stepName + "\"");
        if (trace != null) {
            trace.put("step", stepName);
            trace.put("input", source);
            trace.put("format", format);
            trace.put("messageContext", context);
            trace.put("variables", variables);
            Map<String, Object> parameters = new java.util.LinkedHashMap<>(options);
            parameters.remove("authorization");
            parameters.put("validateOutput", validate);
            trace.put("parameters", parameters);
            trace.put("validationPerformed", false);
        }
        try {
            String output = FmlBridgeAdapter.transform(mapUrl, source, format, context, variables, options, trace);
            if (trace != null) trace.put("output", fr.kazepoy.fhir.mapper.util.FhirJson.parse(output));
            if (validate) {
                if (trace != null) trace.put("phase", "validation");
                FhirValidation result = FmlBridgeAdapter.validate(output, options);
                if (trace != null) {
                    trace.put("validationPerformed", true);
                    trace.put("issues", result.getIssues());
                }
                if (!result.isValid()) throw new IllegalStateException(result.summary());
            }
            if (trace != null) {
                trace.put("phase", "complete");
                trace.put("status", "success");
            }
            return output;
        } catch (Exception e) {
            if (trace != null) {
                trace.put("status", "error");
                trace.put("error", message(e));
            }
            throw new IllegalStateException(label + ", " + mapLabel(mapUrl) + ": " + message(e), e);
        } finally {
            if (trace != null) trace.put("durationMs", (System.nanoTime() - started) / 1_000_000.0);
        }
    }

    public static void clearCaches() throws Exception { FmlBridgeAdapter.clearCaches(); }

    static String message(Throwable e) {
        String message = e.getMessage();
        return message == null || message.isBlank() ? e.getClass().getSimpleName() : message;
    }
}
