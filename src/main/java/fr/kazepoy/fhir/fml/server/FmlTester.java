/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.fml.server;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import fr.kazepoy.fhir.fml.FhirFmlTransformStep;
import fr.kazepoy.fhir.fml.FmlFacade;
import fr.kazepoy.fhir.fml.integration.FmlBridgeAdapter;
import fr.kazepoy.fhir.mapper.fhir.FhirValidation;
import fr.kazepoy.fhir.mapper.util.FhirJson;

/** The test of a FHIR FML Transform step on a sample message, as the editor runs it. */
public final class FmlTester {
    /** How the server turns a sample message into what a transformer sees (OIE's internal XML). */
    public interface Serializer {
        String serialize(String dataType, String message, Map<String, Object> properties) throws Exception;
    }

    private FmlTester() {}

    /** The OIE model of a sample message: request {"message", "dataType", "fhirVersion", "profiles"}. */
    public static String source(String requestJson, Serializer serializer) throws Exception {
        Map<?, ?> request = object(requestJson, "The source request");
        String dataType = dataType(request.get("dataType"));
        String message = serializer.serialize(dataType, text(request.get("message")), properties(request.get("dataTypeProperties")));
        return FmlFacade.source(message, format(dataType, message), Map.of("dataType", dataType), Map.of(), text(request.get("fhirVersion")), text(request.get("profiles")));
    }

    /**
     * Runs a step on a sample message: request {"step", "message", "dataType"}, answer {"model",
     * "output", "validationPerformed", "issues", "errors": [{"phase", "message"}]}.
     */
    public static String test(String requestJson, Serializer serializer) {
        return test(requestJson, serializer, Map.of());
    }

    public static String test(String requestJson, Serializer serializer, Map<String, String> configuration) {
        Map<String, Object> out = new LinkedHashMap<>();
        List<Object> errors = new ArrayList<>();
        List<Object> issues = new ArrayList<>();
        out.put("model", null);
        out.put("output", null);
        out.put("validationPerformed", false);
        String phase = "configuration";
        try {
            Map<?, ?> request = object(requestJson, "The test request");
            FhirFmlTransformStep step = FhirFmlTransformStep.fromJson(FhirJson.write(request.get("step")));
            if (step.mapReference().isBlank()) throw new IllegalArgumentException("Write the map or choose the map to run.");
            Map<String, String> variables = new LinkedHashMap<>();
            for (String name : step.contextVariableNames()) variables.put(name, "");
            phase = "input";
            String message = text(request.get("message"));
            if (message.isBlank()) throw new IllegalArgumentException("Paste a sample message to test the step.");
            String mode = text(request.get("inputMode"));
            String format;
            Map<String, String> context = new LinkedHashMap<>();
            context.put("channelName", "test");
            context.put("connectorName", "test");
            if ("prepared".equals(mode)) {
                format = text(request.get("format"));
                if (!List.of("xml", "json", "raw").contains(format))
                    throw new IllegalArgumentException("Choose XML, JSON or raw text for the prepared message.");
            } else if (mode.isEmpty() || "raw".equals(mode)) {
                String dataType = dataType(request.get("dataType"));
                message = serializer.serialize(dataType, message, properties(request.get("dataTypeProperties")));
                format = format(dataType, message);
                context.put("dataType", dataType);
            } else {
                throw new IllegalArgumentException("Unsupported input mode " + mode + ".");
            }
            Map<String, String> options = step.engineOptions();
            String authorization = step.effectiveTerminologyAuthorization();
            if (!authorization.isBlank()) {
                org.mozilla.javascript.Context cx = new LimitedFactory().enterContext();
                try {
                    var scope = cx.initSafeStandardObjects();
                    scope.put("configurationMap", scope, org.mozilla.javascript.Context.javaToJS(configuration, scope));
                    Object value = cx.evaluateString(scope, "function $cfg(k) { return configurationMap.get(k); }\n(" + authorization + "\n)", "terminology authorization", 1, null);
                    options.put("authorization", org.mozilla.javascript.Context.toString(value));
                } finally { org.mozilla.javascript.Context.exit(); }
            }
            out.put("model", FhirJson.parse(FmlBridgeAdapter.source(message, format, context, variables, options)));
            phase = "transform";
            String output = FmlBridgeAdapter.transform(step.mapReference(), message, format, context, variables, options, null);
            out.put("output", output);
            if (step.isValidateOutput()) {
                phase = "validation";
                FhirValidation result = FmlBridgeAdapter.validate(output, options);
                out.put("validationPerformed", true);
                issues.addAll(result.getIssues());
            }
        } catch (Exception | TimeLimit e) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("phase", e instanceof TimeLimit ? "timeout" : phase);
            error.put("message", e.getMessage() == null ? e.toString() : e.getMessage());
            errors.add(error);
        }
        out.put("issues", issues);
        out.put("errors", errors);
        return FhirJson.write(out);
    }

    /** Checks a map written in a step: request {"mapSource", "fhirVersion", "profiles"}. */
    public static String check(String requestJson) throws Exception {
        Map<?, ?> request = object(requestJson, "The check request");
        return FmlFacade.check(text(request.get("mapSource")), text(request.get("fhirVersion")), text(request.get("profiles")));
    }

    private static Map<?, ?> object(String json, String what) {
        Object parsed = FhirJson.parse(json);
        if (!(parsed instanceof Map)) throw new IllegalArgumentException(what + " is not a JSON object.");
        return (Map<?, ?>) parsed;
    }

    private static String dataType(Object value) {
        String type = text(value).isEmpty() ? "HL7V2" : text(value).toUpperCase();
        if (!List.of("HL7V2", "XML", "JSON", "RAW", "DELIMITED", "FHIR").contains(type)) throw new IllegalArgumentException("Unsupported data type " + type + ".");
        return type;
    }

    /** What the bridge reads: JSON, raw text, or the XML of every other data type. */
    static String format(String dataType, String message) {
        switch (dataType) {
            case "FHIR":
                return message.trim().startsWith("<") ? "xml" : "json";
            case "JSON":
                return "json";
            case "RAW":
                return "raw";
            default:
                return message.trim().startsWith("<") ? "xml" : "raw";
        }
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> properties(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : Map.of();
    }

    private static String text(Object value) { return value == null ? "" : value.toString(); }

    private static final long TIME_LIMIT_MILLIS = 10_000;

    private static final class LimitedFactory extends org.mozilla.javascript.ContextFactory {
        private final long start = System.nanoTime();

        @Override
        protected org.mozilla.javascript.Context makeContext() {
            org.mozilla.javascript.Context cx = super.makeContext();
            cx.setOptimizationLevel(-1);
            cx.setInstructionObserverThreshold(10_000);
            return cx;
        }

        @Override
        protected void observeInstructionCount(org.mozilla.javascript.Context cx, int instructionCount) {
            if (System.nanoTime() - start > TIME_LIMIT_MILLIS * 1_000_000L) {
                throw new TimeLimit();
            }
        }
    }

    private static final class TimeLimit extends Error {
        private static final long serialVersionUID = 1L;

        TimeLimit() {
            super("The test took longer than " + TIME_LIMIT_MILLIS / 1000 + " seconds and was stopped.");
        }
    }
}
