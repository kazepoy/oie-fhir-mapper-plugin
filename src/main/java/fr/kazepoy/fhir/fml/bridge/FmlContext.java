/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.fml.bridge;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.context.FhirVersionEnum;
import ca.uhn.fhir.context.support.IValidationSupport;
import org.hl7.fhir.common.hapi.validation.support.CommonCodeSystemsTerminologyService;
import org.hl7.fhir.common.hapi.validation.support.InMemoryTerminologyServerValidationSupport;
import org.hl7.fhir.common.hapi.validation.support.PrePopulatedValidationSupport;
import org.hl7.fhir.common.hapi.validation.support.SnapshotGeneratingValidationSupport;
import org.hl7.fhir.common.hapi.validation.support.ValidationSupportChain;
import org.hl7.fhir.common.hapi.validation.validator.WorkerContextValidationSupportAdapter;
import org.hl7.fhir.convertors.factory.VersionConvertorFactory_40_50;
import org.hl7.fhir.convertors.factory.VersionConvertorFactory_43_50;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r5.context.IWorkerContext;
import org.hl7.fhir.r5.model.StructureMap;
import org.hl7.fhir.r5.utils.structuremap.StructureMapUtilities;
import org.hl7.fhir.utilities.npm.NpmPackage;

/**
 * The FHIR context of a set of profile locations, as the FML engine sees it: the specification and
 * profiles of FHIR Data Type (the same as for validation), the StructureMaps and ConceptMaps of the
 * locations, and the OIE logical model, exposed as an R5 IWorkerContext by HAPI's adapter.
 */
final class FmlContext {
    static final String FHIR_VERSION = "fhirVersion";
    static final String PROFILES = "profiles";
    private static final String MODEL_RESOURCE = "StructureDefinition-OieMessage.json";

    final IWorkerContext worker;
    final ValidationSupportChain chain;
    private final ca.uhn.fhir.validation.FhirValidator validator;
    /** The maps, R5, by url: parsed from FML or read from the locations. */
    private final Map<String, StructureMap> maps = new LinkedHashMap<>();
    private final Map<String, String> mapSources = new LinkedHashMap<>();
    /** Errors of the files that could not be read, by file. */
    final Map<String, String> errors = new LinkedHashMap<>();

    private FmlContext(ValidationSupportChain chain, IWorkerContext worker) {
        this.chain = chain;
        this.worker = worker;
        validator = chain.getFhirContext().newValidator().registerValidatorModule(
                new org.hl7.fhir.common.hapi.validation.validator.FhirInstanceValidator(chain));
    }

    /** Inline maps (the FML text kept in a step), parsed once per text. */
    private static final int MAX_INLINE = 200;
    private final Map<String, StructureMap> inline = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Deque<String> inlineOrder = new java.util.ArrayDeque<>();
    private int activeUses;
    private boolean closed;

    StructureMap map(String url) { return maps.get(url); }

    String mapSource(String url) {
        StructureMap map = maps.get(url);
        if (map == null) throw new IllegalArgumentException("StructureMap " + url + " is not loaded.");
        return mapSources.containsKey(url) ? mapSources.get(url) : StructureMapUtilities.render(map);
    }

    /** The map written in a step; a parse error is the caller's to report. */
    StructureMap inline(String text) throws Exception {
        StructureMap map = inline.get(text);
        if (map != null) return map;
        synchronized (inline) {
            map = inline.get(text);
            if (map == null) {
                map = new StructureMapUtilities(worker).parse(text, "step");
                while (inline.size() >= MAX_INLINE && !inlineOrder.isEmpty()) {
                    inline.remove(inlineOrder.removeFirst());
                }
                inline.put(text, map);
                inlineOrder.addLast(text);
            }
            return map;
        }
    }

    List<StructureMap> maps() { return new ArrayList<>(maps.values()); }

    synchronized boolean acquire() {
        if (closed) return false;
        activeUses++;
        return true;
    }

    synchronized void release() {
        if (activeUses > 0) activeUses--;
        if (closed && activeUses == 0) chain.stop();
    }

    synchronized void close() {
        if (closed) return;
        closed = true;
        if (activeUses == 0) chain.stop();
    }

    List<Map<String, String>> validate(String json) {
        List<Map<String, String>> issues = new ArrayList<>();
        for (ca.uhn.fhir.validation.SingleValidationMessage message : validator.validateWithResult(json).getMessages()) {
            Map<String, String> issue = new LinkedHashMap<>();
            issue.put("severity", message.getSeverity().getCode());
            issue.put("location", message.getLocationString() == null ? "" : message.getLocationString());
            issue.put("message", message.getMessage() == null ? "" : message.getMessage());
            issues.add(issue);
        }
        return issues;
    }

    static FmlContext load(Object engine, Map<String, String> options) throws Exception {
        FhirVersionEnum version = version(options.get(FHIR_VERSION));
        List<File> fml = new ArrayList<>();
        List<File> others = new ArrayList<>();
        List<String> datatypeLocations = new ArrayList<>();
        for (String entry : options.getOrDefault(PROFILES, "").split(";")) {
            String path = entry.trim();
            if (path.isEmpty()) continue;
            File file = new File(path);
            if (isFml(file)) fml.add(file);
            else {
                others.add(file);
                datatypeLocations.add(path);
            }
        }
        Map<String, String> datatypeOptions = new HashMap<>(options);
        datatypeOptions.put(PROFILES, String.join(";", datatypeLocations));

        FhirContext ctx;
        IValidationSupport base;
        PrePopulatedValidationSupport profiles;
        // validator.computeIfAbsent takes its own lock before specification takes the engine monitor.
        // Warming up under that monitor would invert the order used by concurrent validation.
        invoke(engine, "warmUp", new Class<?>[] { Map.class }, datatypeOptions);
        synchronized (engine) {
            ctx = (FhirContext) invoke(engine, "validationContext", new Class<?>[] { FhirVersionEnum.class }, version);
            base = (IValidationSupport) invoke(engine, "specification", new Class<?>[] { FhirVersionEnum.class, FhirContext.class }, version, ctx);
            profiles = (PrePopulatedValidationSupport) invoke(engine, "loadProfiles", new Class<?>[] { FhirContext.class, String.class },
                    ctx, datatypeOptions.get(PROFILES));
        }

        FmlResources resources = new FmlResources(ctx);
        try (InputStream in = FmlContext.class.getResourceAsStream(MODEL_RESOURCE)) {
            if (in == null) throw new IllegalStateException(MODEL_RESOURCE + " is missing from the FML bridge.");
            resources.add(ctx.newJsonParser().parseResource(new String(in.readAllBytes(), StandardCharsets.UTF_8)));
        }
        List<IValidationSupport> supports = new ArrayList<>();
        supports.add(resources);
        if (profiles != null) supports.add(profiles);
        supports.add(base);
        supports.add(new CommonCodeSystemsTerminologyService(ctx));
        supports.add(new InMemoryTerminologyServerValidationSupport(ctx));
        supports.add(new SnapshotGeneratingValidationSupport(ctx));
        String server = options.getOrDefault("terminologyServer", "").trim();
        if (!server.isEmpty() && !"n/a".equalsIgnoreCase(server)) {
            ca.uhn.fhir.rest.client.apache.ApacheRestfulClientFactory clients = new ca.uhn.fhir.rest.client.apache.ApacheRestfulClientFactory(ctx);
            clients.setServerValidationMode(ca.uhn.fhir.rest.client.api.ServerValidationModeEnum.NEVER);
            int timeout = Integer.parseInt(options.getOrDefault("timeoutSeconds", "10")) * 1000;
            clients.setConnectTimeout(timeout);
            clients.setSocketTimeout(timeout);
            String authorization = options.getOrDefault("authorization", "");
            var remote = new org.hl7.fhir.common.hapi.validation.support.RemoteTerminologyServiceValidationSupport(ctx, server, clients) {
                @Override public ca.uhn.fhir.context.support.TranslateConceptResults translateConcept(IValidationSupport.TranslateCodeRequest request) {
                    if (request.getCodings() == null || request.getCodings().size() != 1 || ctx.getVersion().getVersion() == FhirVersionEnum.R5)
                        return super.translateConcept(request);
                    // FML translates a single code. Use the R4 code/system parameters rather than
                    // HAPI's CodeableConcept envelope, which is not understood by every server.
                    var metadata = new IValidationSupport.TranslateCodeRequest(null, request.getTargetSystemUrl(), request.getConceptMapUrl(),
                            request.getConceptMapVersion(), request.getSourceValueSetUrl(), request.getTargetValueSetUrl(), request.getResourceId(), request.isReverse());
                    var parameters = org.hl7.fhir.common.hapi.validation.support.RemoteTerminologyUtil.buildTranslateInputParameters(ctx, metadata);
                    var coding = request.getCodings().get(0);
                    ca.uhn.fhir.util.ParametersUtil.addParameterToParametersCode(ctx, parameters, "code", coding.getCode());
                    if (coding.getSystem() != null) ca.uhn.fhir.util.ParametersUtil.addParameterToParametersUri(ctx, parameters, "system", coding.getSystem());
                    if (coding.getVersion() != null) ca.uhn.fhir.util.ParametersUtil.addParameterToParametersString(ctx, parameters, "version", coding.getVersion());
                    var client = clients.newGenericClient(server);
                    if (!authorization.isEmpty()) client.registerInterceptor(new ca.uhn.fhir.rest.client.interceptor.AdditionalRequestHeadersInterceptor(
                            Map.of("Authorization", List.of(authorization))));
                    org.hl7.fhir.instance.model.api.IBaseParameters outcome = client.operation().onType("ConceptMap").named("$translate").withParameters(parameters).execute();
                    return org.hl7.fhir.common.hapi.validation.support.RemoteTerminologyUtil.translateOutcomeToResults(ctx, outcome);
                }
            };
            if (!authorization.isEmpty()) remote.addClientInterceptor(new ca.uhn.fhir.rest.client.interceptor.AdditionalRequestHeadersInterceptor(
                    Map.of("Authorization", List.of(authorization))));
            supports.add(remote);
        }
        int seconds = Integer.parseInt(options.getOrDefault("cacheSeconds", "300"));
        var cache = seconds == 0 ? ValidationSupportChain.CacheConfiguration.disabled()
                : ValidationSupportChain.CacheConfiguration.defaultValues().setCacheTimeout(java.time.Duration.ofSeconds(seconds));
        ValidationSupportChain chain = new ValidationSupportChain(cache, supports) {
            @Override public List<IBaseResource> fetchAllStructureDefinitions() {
                // HAPI 8.12.1 returns an empty list here when its cache is disabled.
                if (seconds > 0) return super.fetchAllStructureDefinitions();
                return supports.stream().map(IValidationSupport::fetchAllStructureDefinitions)
                        .filter(java.util.Objects::nonNull).flatMap(List::stream).toList();
            }

            @Override public IBaseResource fetchStructureDefinition(String url) {
                return withSnapshot(super.fetchStructureDefinition(url));
            }

            @Override
            @SuppressWarnings("unchecked")
            public <T extends IBaseResource> T fetchResource(Class<T> theClass, String theUri) {
                T resource = super.fetchResource(theClass, theUri);
                if (resource != null && "StructureDefinition".equals(ctx.getResourceType(resource))) {
                    return (T) withSnapshot(resource);
                }
                return resource;
            }

            private synchronized IBaseResource withSnapshot(IBaseResource sd) {
                if (sd == null) return null;
                ca.uhn.fhir.util.FhirTerser terser = ctx.newTerser();
                if (!terser.getValues(sd, "snapshot.element").isEmpty()) return sd;
                String url = terser.getSinglePrimitiveValueOrNull(sd, "url");
                String name = terser.getSinglePrimitiveValueOrNull(sd, "name");
                IBaseResource generated = generateSnapshot(
                        new ca.uhn.fhir.context.support.ValidationSupportContext(this), terser.clone(sd), url, null, name);
                if (generated != null && !terser.getValues(generated, "snapshot.element").isEmpty()) {
                    resources.add(generated);
                    return generated;
                }
                return sd;
            }
        };
        IWorkerContext worker = WorkerContextValidationSupportAdapter.newVersionSpecificWorkerContextWrapper(chain);
        FmlContext context = new FmlContext(chain, worker);

        // StructureMaps and ConceptMaps of the locations: the datatype keeps neither.
        List<File> files = new ArrayList<>(fml);
        for (File location : others) collect(location, files);
        StructureMapUtilities parser = new StructureMapUtilities(worker);
        for (File file : files) {
            try {
                if (isFml(file)) {
                    String text = Files.readString(file.toPath(), StandardCharsets.UTF_8);
                    StructureMap map = parser.parse(text, file.getName());
                    context.maps.put(map.getUrl(), map);
                    context.mapSources.put(map.getUrl(), text);
                    resources.add(fromR5(map, version));
                } else if (isPackage(file)) {
                    try (InputStream in = new FileInputStream(file)) {
                        NpmPackage pkg = NpmPackage.fromPackage(in);
                        for (String type : new String[] { "StructureMap", "ConceptMap" }) {
                            for (String name : pkg.listResources(type)) {
                                try (InputStream r = pkg.load("package", name)) {
                                    context.add(resources, ctx.newJsonParser().parseResource(new String(r.readAllBytes(), StandardCharsets.UTF_8)), version);
                                }
                            }
                        }
                    }
                } else {
                    String text = Files.readString(file.toPath(), StandardCharsets.UTF_8);
                    // Only canonical resources the datatype does not keep; a file it cannot read was refused by it.
                    if (isMapOrConceptMapResource(file.getName(), text)) {
                        IBaseResource resource = file.getName().toLowerCase().endsWith(".xml")
                                ? ctx.newXmlParser().parseResource(text) : ctx.newJsonParser().parseResource(text);
                        context.add(resources, resource, version);
                    }
                }
            } catch (Exception e) {
                context.errors.put(file.getPath(), e.getMessage() == null ? e.toString() : e.getMessage());
            }
        }
        return context;
    }

    private void add(FmlResources resources, IBaseResource resource, FhirVersionEnum version) {
        if (!resources.add(resource)) return;
        if ("StructureMap".equals(resource.fhirType())) {
            StructureMap map = toR5(resource, version);
            maps.putIfAbsent(map.getUrl(), map);
        }
    }

    private static StructureMap toR5(IBaseResource resource, FhirVersionEnum version) {
        switch (version) {
            case R4:
                return (StructureMap) VersionConvertorFactory_40_50.convertResource((org.hl7.fhir.r4.model.Resource) resource);
            case R4B:
                return (StructureMap) VersionConvertorFactory_43_50.convertResource((org.hl7.fhir.r4b.model.Resource) resource);
            default:
                return (StructureMap) resource;
        }
    }

    private static IBaseResource fromR5(StructureMap map, FhirVersionEnum version) {
        switch (version) {
            case R4:
                return VersionConvertorFactory_40_50.convertResource(map);
            case R4B:
                return VersionConvertorFactory_43_50.convertResource(map);
            default:
                return map;
        }
    }

    private static void collect(File location, List<File> files) {
        if (location.isDirectory()) {
            File[] children = location.listFiles();
            if (children == null) return;
            Arrays.sort(children);
            for (File child : children) collect(child, files);
        } else if (location.isFile()) {
            String name = location.getName().toLowerCase();
            if (isFml(location) || isPackage(location) || name.endsWith(".json") || name.endsWith(".xml")) files.add(location);
        }
    }

    private static final java.util.regex.Pattern JSON_MAP_OR_CM =
            java.util.regex.Pattern.compile("\"resourceType\"\\s*:\\s*\"(?:StructureMap|ConceptMap)\"");
    private static final java.util.regex.Pattern XML_MAP_OR_CM =
            java.util.regex.Pattern.compile("<(?:[A-Za-z0-9_.-]+:)?(?:StructureMap|ConceptMap)(?:\\s|>|/)");

    private static boolean isMapOrConceptMapResource(String fileName, String text) {
        if (!text.contains("StructureMap") && !text.contains("ConceptMap")) return false;
        return fileName.toLowerCase().endsWith(".xml")
                ? XML_MAP_OR_CM.matcher(text).find()
                : JSON_MAP_OR_CM.matcher(text).find();
    }

    private static boolean isFml(File file) {
        String name = file.getName().toLowerCase();
        return name.endsWith(".fml") || name.endsWith(".map");
    }

    private static boolean isPackage(File file) {
        String name = file.getName().toLowerCase();
        return name.endsWith(".tgz") || name.endsWith(".tar.gz");
    }

    static FhirVersionEnum version(String fhirVersion) {
        String version = fhirVersion == null ? "" : fhirVersion.trim().toUpperCase();
        switch (version) {
            case "":
            case "R4":
                return FhirVersionEnum.R4;
            case "R4B":
                return FhirVersionEnum.R4B;
            case "R5":
                return FhirVersionEnum.R5;
            default:
                throw new IllegalArgumentException("FHIR version " + fhirVersion + " is not supported. Use R4, R4B or R5.");
        }
    }

    // Compatibility boundary for FHIR Data Type 1.6.2, as in FhirCatalogBridge: the datatype's own
    // validation context, specification and profile loading.
    private static Object invoke(Object engine, String name, Class<?>[] types, Object... args) throws Exception {
        try {
            Method method = engine.getClass().getDeclaredMethod(name, types);
            method.setAccessible(true);
            return method.invoke(engine, args);
        } catch (NoSuchMethodException e) {
            throw new IllegalStateException("FHIR Data Type 1.6.2 compatibility: missing " + name, e);
        } catch (InvocationTargetException e) {
            if (e.getCause() instanceof Exception) throw (Exception) e.getCause();
            throw e;
        }
    }
}
