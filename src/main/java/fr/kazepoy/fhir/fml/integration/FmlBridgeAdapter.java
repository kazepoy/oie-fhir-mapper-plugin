/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.fml.integration;

import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.Map;

import com.mirth.connect.plugins.datatypes.fhir.FhirEngine;
import com.mirth.connect.plugins.datatypes.fhir.FhirEngineLoader;
import com.mirth.connect.plugins.datatypes.fhir.FhirSerializationProperties;

/**
 * The only entry point into the FML bridge (lib/fhir-fml-bridge.jar), loaded under the class
 * loader of FHIR Data Type: the bridge uses the HAPI and HL7 core libraries the datatype ships,
 * and nothing else. Calls carry Strings and java.util Maps only.
 */
public final class FmlBridgeAdapter {
    private static final String BRIDGE = "fr.kazepoy.fhir.fml.bridge.FmlBridge";
    private static Object bridge;

    private FmlBridgeAdapter() {}

    /** The datatype's options for a FHIR version and profile locations. */
    public static Map<String, String> options(String version, String profiles) {
        FhirSerializationProperties properties = new FhirSerializationProperties();
        properties.setFhirVersion(FhirSerializationProperties.FhirVersion.valueOf(version == null || version.isBlank() ? "R4" : version.trim().toUpperCase()));
        properties.setProfiles(profiles == null ? "" : profiles);
        return properties.engineOptions();
    }

    private static Map<String, String> options(String version, String profiles, String sourceModel, String sourceModelUrl) {
        Map<String, String> options = options(version, profiles);
        options.put("sourceModel", sourceModel == null ? "" : sourceModel);
        options.put("sourceModelUrl", sourceModelUrl == null ? "" : sourceModelUrl);
        return options;
    }

    public static String listMaps(String version, String profiles) throws Exception {
        return (String) call("listMaps", new Class<?>[] { Map.class }, options(version, profiles));
    }

    public static String mapSource(String url, String version, String profiles) throws Exception {
        return (String) call("mapSource", new Class<?>[] { String.class, Map.class }, url, options(version, profiles));
    }

    public static String source(String source, String format, Map<String, String> context, Map<String, String> variables,
            String version, String profiles, String sourceModel, String sourceModelUrl) throws Exception {
        return source(source, format, context, variables, options(version, profiles, sourceModel, sourceModelUrl));
    }

    public static String source(String source, String format, Map<String, String> context, Map<String, String> variables,
            Map<String, String> options) throws Exception {
        return (String) call("source", new Class<?>[] { String.class, String.class, Map.class, Map.class, Map.class },
                source, format, context, variables, options);
    }

    public static String transform(String map, String source, String format, Map<String, String> context, Map<String, String> variables,
            Map<String, String> options, Map<String, Object> trace) throws Exception {
        return (String) call("transform", new Class<?>[] { String.class, String.class, String.class, Map.class, Map.class, Map.class, Map.class },
                map, source, format, context, variables, options, trace);
    }

    @SuppressWarnings("unchecked")
    public static fr.kazepoy.fhir.mapper.fhir.FhirValidation validate(String json, Map<String, String> options) throws Exception {
        return new fr.kazepoy.fhir.mapper.fhir.FhirValidation((java.util.List<Map<String, String>>) call("validate", new Class<?>[] { String.class, Map.class }, json, options));
    }

    public static String check(String mapSource, String version, String profiles) throws Exception {
        return (String) call("check", new Class<?>[] { String.class, Map.class }, mapSource, options(version, profiles));
    }

    public static synchronized void clearCaches() throws Exception {
        if (bridge != null) call("clearCaches", new Class<?>[0]);
    }

    private static synchronized Object bridge() throws Exception {
        if (bridge == null) {
            FhirEngine engine = FhirEngineLoader.engine();
            Class<?> type;
            if (Boolean.getBoolean("fhir.fml.bridge.direct")) {
                type = Class.forName(BRIDGE);
            } else {
                File jar = new File(FmlBridgeAdapter.class.getProtectionDomain().getCodeSource().getLocation().toURI());
                File bridgeJar = new File(jar.getParentFile(), "lib/fhir-fml-bridge.jar");
                ClassLoader loader = new URLClassLoader(new URL[] { bridgeJar.toURI().toURL() }, engine.getClass().getClassLoader());
                type = Class.forName(BRIDGE, true, loader);
            }
            bridge = type.getConstructor(Object.class).newInstance(engine);
        }
        return bridge;
    }

    private static Object call(String name, Class<?>[] types, Object... args) throws Exception {
        Object target = bridge();
        try {
            return target.getClass().getMethod(name, types).invoke(target, args);
        } catch (InvocationTargetException e) {
            if (e.getCause() instanceof Exception) throw (Exception) e.getCause();
            throw e;
        }
    }
}
