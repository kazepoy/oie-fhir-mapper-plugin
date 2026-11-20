/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.fml;

import java.util.Map;
import java.util.LinkedHashMap;
import java.util.regex.Pattern;

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

    private static final Pattern REFERENCE_VARIABLE = Pattern.compile("\\$\\{([A-Za-z_$][A-Za-z0-9_$.\\-]*)\\}");

    /** A whole canonical reference may be supplied by one OIE variable; inline FML is literal. */
    public static String referenceVariable(String reference) {
        if (reference == null || reference.startsWith(INLINE)) return null;
        var match = REFERENCE_VARIABLE.matcher(reference.trim());
        if (match.matches()) return match.group(1);
        if (reference.contains("${"))
            throw new IllegalArgumentException("Use a canonical URL or a whole variable reference such as ${fmlMapUrl}.");
        return null;
    }

    private static String resolveReference(String label, String reference, Map<String, String> variables) {
        String name = referenceVariable(reference);
        if (name == null) return reference == null ? "" : reference.trim();
        String value = variables.get(name);
        if (value == null || value.isBlank())
            throw new IllegalArgumentException(label + ": variable " + name + " is missing or empty.");
        if (value.trim().startsWith(INLINE))
            throw new IllegalArgumentException(label + ": variable " + name + " must contain a canonical URL, not inline FML.");
        return value.trim();
    }

    /** Resolve per-message values without changing the step or the cached FHIR context. */
    public static Map<String, String> resolveReferences(Map<String, String> options, Map<String, String> variables) {
        Map<String, String> resolved = new LinkedHashMap<>(options);
        resolved.put("mapReference", resolveReference("FML map", options.get("mapReference"), variables));
        if ("logical".equals(options.get("sourceModel")))
            resolved.put("sourceModelUrl", resolveReference("Logical source model", options.get("sourceModelUrl"), variables));
        return resolved;
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
            options = new LinkedHashMap<>(options);
            options.put("mapReference", mapUrl);
            if (trace != null) trace.put("phase", "configuration");
            options = resolveReferences(options, variables);
            mapUrl = options.get("mapReference");
            if (trace != null) {
                trace.put("mapReference", mapUrl);
                trace.put("sourceModelUrl", options.getOrDefault("sourceModelUrl", ""));
                Map<String, Object> parameters = new LinkedHashMap<>(options);
                parameters.remove("authorization");
                parameters.put("validateOutput", validate);
                trace.put("parameters", parameters);
            }
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
