/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.fml.bridge;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.HashMap;
import java.util.List;
import java.util.TreeMap;
import java.util.concurrent.Callable;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.hl7.fhir.exceptions.FHIRException;
import org.hl7.fhir.r5.context.IWorkerContext;
import org.hl7.fhir.r5.elementmodel.Element;
import org.hl7.fhir.r5.elementmodel.JsonParser;
import org.hl7.fhir.r5.elementmodel.Manager;
import org.hl7.fhir.r5.formats.IParser.OutputStyle;
import org.hl7.fhir.r5.model.StructureDefinition;
import org.hl7.fhir.r5.model.StructureMap;
import org.hl7.fhir.r5.model.StructureMap.StructureMapGroupComponent;
import org.hl7.fhir.r5.model.StructureMap.StructureMapGroupInputComponent;
import org.hl7.fhir.r5.model.StructureMap.StructureMapInputMode;
import org.hl7.fhir.r5.model.StructureMap.StructureMapStructureComponent;
import org.hl7.fhir.r5.utils.structuremap.StructureMapUtilities;

/**
 * Runs FML maps (StructureMaps) on the OIE logical model, with the FML engine of the HL7 core that
 * FHIR Data Type ships. Loaded under the datatype's HAPI class loader; called by reflection from
 * fr.kazepoy.fhir.fml.integration.FmlBridgeAdapter with java.util and String arguments only.
 *
 * Options are those of the datatype (fhirVersion, profiles…). The profile locations also hold the
 * maps: .fml or .map files, StructureMap resources and packages.
 */
public final class FmlBridge {
    /** Prefix of a map reference that carries the FML text itself, not a canonical URL. */
    static final String INLINE = "inline:";
    private static final int MAX_CONTEXTS = 32;
    private final Object engine;
    private final Map<String, FmlContext> contexts = new java.util.LinkedHashMap<>(16, 0.75f, true);
    private final Map<String, Object> keyLocks = new java.util.concurrent.ConcurrentHashMap<>();

    public FmlBridge(Object engine) { this.engine = engine; }

    /** The maps of the locations: [{url, name, title}], and the files that could not be read. */
    public String listMaps(Map<String, String> options) throws Exception {
        return withContext(options, context -> {
            ObjectMapper mapper = new ObjectMapper();
            Map<String, ObjectNode> sorted = new TreeMap<>();
            for (StructureMap map : context.maps()) {
                ObjectNode item = mapper.createObjectNode();
                item.put("url", map.getUrl());
                item.put("name", map.hasName() ? map.getName() : map.getUrl());
                item.put("title", map.hasTitle() ? map.getTitle() : (map.hasName() ? map.getName() : map.getUrl()));
                sorted.put(map.getUrl(), item);
            }
            ObjectNode result = mapper.createObjectNode();
            ArrayNode maps = result.putArray("maps");
            sorted.values().forEach(maps::add);
            ObjectNode errors = result.putObject("errors");
            context.errors.forEach(errors::put);
            return mapper.writeValueAsString(result);
        });
    }

    public String mapSource(String url, Map<String, String> options) throws Exception {
        return withContext(options, context -> context.mapSource(url));
    }

    /** The instance of the OIE logical model a map receives for this message, as JSON. */
    public String source(String source, String format, Map<String, String> messageContext, Map<String, String> variables,
            Map<String, String> options) throws Exception {
        return withContext(options, context ->
                compose(context.worker, FmlSourceBuilder.build(context.worker, source, format, messageContext, variables, options)));
    }

    /** Runs a map on a message and returns its target (a resource, often a Bundle) as JSON. */
    public String transform(String mapUrl, String source, String format, Map<String, String> messageContext, Map<String, String> variables,
            Map<String, String> options) throws Exception {
        return transform(mapUrl, source, format, messageContext, variables, options, null);
    }

    public String transform(String mapUrl, String source, String format, Map<String, String> messageContext, Map<String, String> variables,
            Map<String, String> options, Map<String, Object> trace) throws Exception {
        return withContext(options, context -> {
            if (trace != null) trace.put("phase", "map");
            String url = mapUrl == null ? "" : mapUrl.trim();
            StructureMap map = url.startsWith(INLINE) ? context.inline(mapUrl.substring(mapUrl.indexOf(INLINE) + INLINE.length())) : context.map(url);
            if (map == null) {
                throw new IllegalArgumentException("StructureMap " + url + " is not in the profile locations of the step"
                        + (context.errors.isEmpty() ? "." : " (unreadable files: " + String.join(", ", context.errors.keySet()) + ")."));
            }
            // Utilities, services and source/target Elements are request-local. The cached worker and
            // StructureMaps are read-only after context loading, so transformations need no global lock.
            IWorkerContext worker = context.worker;
            if (trace != null) trace.put("phase", "source");
            Element src = FmlSourceBuilder.build(worker, source, format, messageContext, variables, options);
            if (trace != null) trace.put("sourceModelUrl", options.getOrDefault("sourceModelUrl", ""));
            if (trace != null) trace.put("fmlSource", new ObjectMapper().readValue(compose(worker, src), Object.class));
            verifySourceType(worker, map, src);
            OieTransformerServices services = new OieTransformerServices(worker, context.chain);
            StructureMapUtilities utilities = new StructureMapUtilities(worker, services);
            Element target = Manager.build(worker, targetType(worker, map));
            if (trace != null) trace.put("phase", "transform");
            try {
                utilities.transform(null, src, map, target);
                return compose(worker, target);
            } finally {
                if (trace != null) trace.put("logs", services.log());
            }
        });
    }

    /**
     * Parses a map written in a step: {"url", "name", "groups": [...], "errors": [{"line", "column",
     * "message"}]}. Also reports the structures the map uses that the locations do not have.
     */
    public String check(String mapSource, Map<String, String> options) throws Exception {
        return withContext(options, context -> {
            ObjectMapper mapper = new ObjectMapper();
            ObjectNode result = mapper.createObjectNode();
            ArrayNode errors = mapper.createArrayNode();
            synchronized (context) {
                try {
                    StructureMap map = new StructureMapUtilities(context.worker).parse(mapSource == null ? "" : mapSource, "step");
                    result.put("url", map.getUrl());
                    result.put("name", map.hasName() ? map.getName() : "");
                    ArrayNode groups = result.putArray("groups");
                    for (StructureMapGroupComponent group : map.getGroup()) groups.add(group.getName());
                    for (StructureMapStructureComponent uses : map.getStructure()) {
                        StructureDefinition sd = context.worker.fetchResource(StructureDefinition.class, uses.getUrl(), IWorkerContext.VersionResolutionRules.defaultRule());
                        if (sd == null) errors.add(problem(mapper, mapSource, uses.getUrl(), "uses " + uses.getUrl() + ": this structure is not in the profile locations of the step."));
                    }
                    for (org.hl7.fhir.r5.model.CanonicalType imported : map.getImport()) {
                        if (context.map(imported.getValue()) == null)
                            errors.add(problem(mapper, mapSource, imported.getValue(), "imports " + imported.getValue() + ": this map is not in the profile locations of the step."));
                    }
                } catch (Exception e) {
                    errors.add(located(mapper, e));
                }
            }
            result.set("errors", errors);
            return mapper.writeValueAsString(result);
        });
    }

    /** A problem on the first line that holds a text of the map. */
    private static ObjectNode problem(ObjectMapper mapper, String source, String text, String message) {
        ObjectNode error = mapper.createObjectNode();
        String[] lines = (source == null ? "" : source).split("\n", -1);
        int line = 1, column = 1;
        for (int i = 0; i < lines.length; i++) {
            int at = lines[i].indexOf(text);
            if (at >= 0) { line = i + 1; column = at + 1; break; }
        }
        error.put("line", line);
        error.put("column", column);
        error.put("message", message);
        return error;
    }

    private static final java.util.regex.Pattern LOCATION = java.util.regex.Pattern.compile("(?:@|at|line)\\s*(\\d+)\\s*[,:]\\s*(?:col(?:umn)?\\s*)?(\\d+)", java.util.regex.Pattern.CASE_INSENSITIVE);

    /** The parser's error with its position: from the exception's location, else from its message. */
    private static ObjectNode located(ObjectMapper mapper, Exception e) {
        ObjectNode error = mapper.createObjectNode();
        int line = 1, column = 1;
        try {
            Object location = e.getClass().getMethod("getLocation").invoke(e);
            if (location != null) {
                line = ((Number) location.getClass().getMethod("getLine").invoke(location)).intValue();
                column = ((Number) location.getClass().getMethod("getColumn").invoke(location)).intValue();
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // no location on this exception: read the message
        }
        String message = e.getMessage() == null ? e.toString() : e.getMessage();
        if (line <= 1 && column <= 1) {
            java.util.regex.Matcher m = LOCATION.matcher(message);
            if (m.find()) { line = Integer.parseInt(m.group(1)); column = Integer.parseInt(m.group(2)); }
        }
        error.put("line", Math.max(1, line));
        error.put("column", Math.max(1, column));
        error.put("message", message);
        return error;
    }

    @FunctionalInterface
    private interface ContextWork<T> { T call(FmlContext context) throws Exception; }

    public void clearCaches() {
        List<FmlContext> toClose;
        synchronized (contexts) {
            toClose = new java.util.ArrayList<>(contexts.values());
            contexts.clear();
            keyLocks.clear();
        }
        for (FmlContext context : toClose) context.close();
    }

    private <T> T withContext(Map<String, String> options, ContextWork<T> work) throws Exception {
        return withEngineClassLoader(() -> {
            FmlContext context = acquireContext(options);
            try {
                return work.call(context);
            } finally {
                context.release();
            }
        });
    }

    private FmlContext acquireContext(Map<String, String> options) throws Exception {
        String key = new TreeMap<>(options).entrySet().stream()
                .filter(e -> !List.of("mapReference", "sourceModel", "sourceModelUrl").contains(e.getKey()))
                .map(e -> e.getKey().length() + ":" + e.getKey() + e.getValue().length() + ":" + e.getValue()).collect(java.util.stream.Collectors.joining());
        while (true) {
            synchronized (contexts) {
                FmlContext existing = contexts.get(key);
                if (existing != null) {
                    if (existing.acquire()) return existing;
                    contexts.remove(key);
                }
            }
            FmlContext evicted = null;
            FmlContext acquired = null;
            synchronized (keyLocks.computeIfAbsent(key, k -> new Object())) {
                synchronized (contexts) {
                    FmlContext existing = contexts.get(key);
                    if (existing != null) {
                        if (existing.acquire()) acquired = existing;
                        else contexts.remove(key);
                    }
                }
                if (acquired == null) {
                    FmlContext loaded = FmlContext.load(engine, options);
                    synchronized (contexts) {
                        loaded.acquire();
                        if (contexts.size() >= MAX_CONTEXTS) {
                            var it = contexts.entrySet().iterator();
                            if (it.hasNext()) {
                                evicted = it.next().getValue();
                                it.remove();
                            }
                        }
                        contexts.put(key, loaded);
                        acquired = loaded;
                    }
                }
            }
            if (evicted != null) evicted.close();
            if (acquired != null) return acquired;
        }
    }

    public List<Map<String, String>> validate(String json, Map<String, String> options) throws Exception {
        return withContext(options, context -> context.validate(json));
    }

    /**
     * The type of the target parameter of the map's first group, resolved through the map's uses:
     * the core's getTargetType refuses a map that uses several targets (a Bundle and its entries).
     */
    private static StructureDefinition targetType(IWorkerContext worker, StructureMap map) {
        return parameterType(worker, map, StructureMapInputMode.TARGET);
    }

    /** Ensures the built source instance is compatible with the entry group's source parameter before rules run. */
    private static void verifySourceType(IWorkerContext worker, StructureMap map, Element src) {
        StructureDefinition expected = parameterType(worker, map, StructureMapInputMode.SOURCE);
        StructureDefinition actual = src != null && src.getProperty() != null ? src.getProperty().getStructure() : null;
        if (actual == null && src != null && src.fhirType() != null) {
            actual = fetchStructureDefinition(worker, src.fhirType());
        }
        if (isCompatibleSource(worker, actual, expected)) {
            return;
        }
        String actualLabel = actual == null ? (src == null ? "null" : src.fhirType())
                : actual.getType() + " (" + actual.getUrl() + ")";
        String expectedLabel = expected.getType() + " (" + expected.getUrl() + ")";
        throw new FHIRException("Incompatible source type " + actualLabel + " for StructureMap " + map.getUrl()
                + " (expected " + expectedLabel + ").");
    }

    private static boolean isCompatibleSource(IWorkerContext worker, StructureDefinition actual, StructureDefinition expected) {
        if (actual == null || expected == null) return false;
        if (isSubtypeOf(worker, actual, expected.getUrl())) return true;
        if (expected.getKind() == StructureDefinition.StructureDefinitionKind.RESOURCE
                && expected.getDerivation() == StructureDefinition.TypeDerivationRule.CONSTRAINT
                && actual.getKind() == StructureDefinition.StructureDefinitionKind.RESOURCE) {
            return expected.hasType() && expected.getType().equals(actual.getType())
                    && (actual.getDerivation() != StructureDefinition.TypeDerivationRule.CONSTRAINT
                            || isSubtypeOf(worker, actual, expected.getUrl()));
        }
        return false;
    }

    private static boolean isSubtypeOf(IWorkerContext worker, StructureDefinition actual, String expectedUrl) {
        if (expectedUrl == null) return false;
        StructureDefinition current = actual;
        java.util.Set<String> seen = new java.util.HashSet<>();
        while (current != null) {
            if (expectedUrl.equals(current.getUrl())) return true;
            String base = current.getBaseDefinition();
            if (base == null || base.isEmpty() || !seen.add(base)) break;
            current = fetchStructureDefinition(worker, base);
        }
        return false;
    }

    private static StructureDefinition parameterType(IWorkerContext worker, StructureMap map, StructureMapInputMode mode) {
        if (!map.hasGroup()) throw new FHIRException("StructureMap " + map.getUrl() + " has no group.");
        StructureMapGroupComponent group = map.getGroupFirstRep();
        List<StructureMapGroupInputComponent> inputs = group.getInput().stream().filter(i -> i.getMode() == mode).toList();
        if (inputs.size() != 1 || !inputs.get(0).hasType())
            throw new FHIRException("The first group of " + map.getUrl() + " needs exactly one typed " + mode.toCode() + " parameter.");
        String type = inputs.get(0).getType();
        List<StructureMapStructureComponent> modeUses = map.getStructure().stream()
                .filter(u -> u.getMode() != null && u.getMode().toCode().equals(mode.toCode())).toList();
        List<StructureMapStructureComponent> uses = modeUses.stream()
                .filter(u -> type.equals(u.getAlias()) || type.equals(u.getUrl())).toList();
        if (uses.isEmpty()) {
            uses = modeUses.stream().filter(u -> matchesStructure(worker, u, type)).toList();
        }
        if (uses.size() > 1) throw new FHIRException("Ambiguous model " + type + " in map " + map.getUrl() + ".");
        String url = uses.isEmpty() ? type : uses.get(0).getUrl();
        StructureDefinition sd = fetchStructureDefinition(worker, url);
        if (sd == null) throw new FHIRException("Unable to find the " + mode.toCode() + " model " + url + " of map " + map.getUrl() + ".");
        return sd;
    }

    private static boolean matchesStructure(IWorkerContext worker, StructureMapStructureComponent u, String type) {
        if (u.getUrl() == null) return false;
        if (u.getUrl().endsWith("/" + type)) return true;
        StructureDefinition sd = worker.fetchResource(StructureDefinition.class, u.getUrl(), IWorkerContext.VersionResolutionRules.defaultRule());
        return sd != null && (type.equals(sd.getName()) || type.equals(sd.getType()) || type.equals(sd.getIdElement().getIdPart()));
    }

    static StructureDefinition fetchStructureDefinition(IWorkerContext worker, String nameOrUrl) {
        StructureDefinition sd = worker.fetchResource(StructureDefinition.class, nameOrUrl, IWorkerContext.VersionResolutionRules.defaultRule());
        if (sd == null && !nameOrUrl.contains("/")) sd = worker.fetchTypeDefinition(nameOrUrl);
        if (sd != null && !sd.hasSnapshot() && sd.hasUrl()) {
            StructureDefinition withSnap = worker.fetchResource(StructureDefinition.class, sd.getUrl(), IWorkerContext.VersionResolutionRules.defaultRule());
            if (withSnap != null) sd = withSnap;
        }
        return sd;
    }

    private static String compose(IWorkerContext worker, Element element) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new JsonParser(worker).compose(element, out, OutputStyle.NORMAL, null);
        return out.toString(StandardCharsets.UTF_8);
    }

    private <T> T withEngineClassLoader(Callable<T> work) throws Exception {
        Thread thread = Thread.currentThread();
        ClassLoader previous = thread.getContextClassLoader();
        thread.setContextClassLoader(getClass().getClassLoader());
        try {
            return work.call();
        } finally {
            thread.setContextClassLoader(previous);
        }
    }
}
