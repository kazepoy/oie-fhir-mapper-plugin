/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.fml.bridge;

import static org.junit.Assert.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mirth.connect.plugins.datatypes.fhir.FhirEngineLoader;
import com.mirth.connect.plugins.datatypes.fhir.FhirSerializationProperties;
import org.junit.AfterClass;
import org.junit.BeforeClass;
import org.junit.Test;

/** The FML engine of the HL7 core, through HAPI's worker context, on the generic OIE model. */
public class FmlBridgeTest {
    private static final String PATIENT_MAP = "http://example.org/fhir/StructureMap/OruPatient";
    private static final String BUNDLE_MAP = "http://example.org/fhir/StructureMap/OruBundle";
    private static final String ORDER_MODEL = "http://example.org/fml-demo/StructureDefinition/CommandeSource";
    private static final String ORDER_MAP = "http://example.org/fml-demo/StructureMap/CommandeToBon";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static FmlBridge bridge;
    private static String oru;
    private static String strictOru;

    private static String fixture(String name) { return Path.of("src/test/resources", name).toAbsolutePath().toString(); }

    private static Map<String, String> options() {
        FhirSerializationProperties properties = new FhirSerializationProperties();
        properties.setProfiles(fixture("fml/maps") + ";" + fixture("conceptmaps/v2-sex-r4.json"));
        return properties.engineOptions();
    }

    private static Map<String, String> logicalOrderOptions() {
        Map<String, String> opts = new LinkedHashMap<>(options());
        opts.put("profiles", Path.of("demo/fhir-volume/06-json-order-to-dispatch").toAbsolutePath().toString());
        opts.put("sourceModel", "logical");
        opts.put("sourceModelUrl", ORDER_MODEL);
        return opts;
    }

    @BeforeClass
    public static void load() throws Exception {
        bridge = new FmlBridge(FhirEngineLoader.engine());
        oru = Files.readString(Path.of(fixture("fml/messages/oru-r01-minimal.xml")));
        strictOru = Files.readString(Path.of(fixture("fml/messages/oru-r01-strict.xml")));
    }

    @AfterClass
    public static void close() { bridge.clearCaches(); }

    @Test
    public void readsLogicalPidXmlUsingItsStructureDefinitions() throws Exception {
        Map<String, String> opts = new LinkedHashMap<>(options());
        opts.put("profiles", Path.of("demo/fhir-volume/04-hl7v2-pid-fr-core-ins").toAbsolutePath().toString());
        opts.put("sourceModel", "logical");
        opts.put("sourceModelUrl", "http://example.org/fhir/hl7v2-demo/StructureDefinition/PID");
        String input = Files.readString(Path.of("demo/oie-init/data/samples/04-hl7v2-pid-fr-core-ins/pid.xml"));
        JsonNode source = JSON.readTree(bridge.source(input, "xml", Map.of(), Map.of(), opts));
        assertEquals("000003", source.path("PID_3").get(0).path("CX_1").path("value").asText());
        assertEquals("279035121518989", source.path("PID_3").get(1).path("CX_1").path("value").asText());
        assertEquals("PAT-TROIS", source.path("PID_5").get(0).path("XPN_1").path("FN_1").path("value").asText());
        assertEquals(source.toPrettyString(), "F", source.path("PID_8").path("value").asText());
    }

    @Test
    public void transformsBusinessJsonBetweenTwoLogicalModelsWithoutFhirResourceType() throws Exception {
        Map<String, String> opts = new LinkedHashMap<>(options());
        opts.put("profiles", Path.of("demo/fhir-volume/06-json-order-to-dispatch").toAbsolutePath().toString());
        opts.put("sourceModel", "logical");
        opts.put("sourceModelUrl", "http://example.org/fml-demo/StructureDefinition/CommandeSource");
        String input = Files.readString(Path.of("demo/oie-init/data/samples/06-json-order-to-dispatch/input.json"));
        assertEquals(JSON.readTree(input), JSON.readTree(bridge.source(input, "json", Map.of(), Map.of(), opts)));
        String map = "http://example.org/fml-demo/StructureMap/CommandeToBon";
        JsonNode output = JSON.readTree(bridge.transform(map, input, "json", Map.of(), Map.of(), opts));
        assertEquals(JSON.readTree(Files.readString(Path.of("demo/oie-init/data/samples/06-json-order-to-dispatch/expected.json"))), output);
        assertFalse(output.has("resourceType"));
        var standard = (com.fasterxml.jackson.databind.node.ObjectNode) JSON.readTree(input);
        standard.put("urgent", false);
        assertEquals("standard", JSON.readTree(bridge.transform(map, standard.toString(), "json", Map.of(), Map.of(), opts)).path("priorite").asText());
    }

    @Test
    public void transformsAFhirSourceUsingItsExistingModel() throws Exception {
        Map<String, String> opts = new LinkedHashMap<>(options());
        opts.put("profiles", Path.of("demo/fhir-volume/05-fhir-patient-normalization").toAbsolutePath().toString());
        opts.put("sourceModel", "fhir");
        String input = Files.readString(Path.of("demo/oie-init/data/samples/05-fhir-patient-normalization/input.json"));
        JsonNode output = JSON.readTree(bridge.transform("http://example.org/fhir/StructureMap/PatientDemo", input, "json", Map.of(), Map.of(), opts));
        assertEquals(JSON.readTree(Files.readString(Path.of("demo/oie-init/data/samples/05-fhir-patient-normalization/expected.json"))), output);
    }

    @Test
    public void reportsAnUnknownOrAmbiguousFmlSourceModel() throws Exception {
        Map<String, String> opts = new LinkedHashMap<>(options());
        opts.put("sourceModel", "fhir");
        String header = "map \"http://example.org/test\" = \"Test\"\nuses \"http://hl7.org/fhir/StructureDefinition/Patient\" alias Patient as target\n";
        for (String group : List.of("group Test(source src : Missing, target tgt : Patient) { src -> tgt.active = true \"a\"; }",
                "group Test(source src : Patient, source second : Patient, target tgt : Patient) { src -> tgt.active = true \"a\"; }")) {
            try {
                bridge.transform("inline:" + header + group, "{}", "json", Map.of(), Map.of(), opts);
                fail("Expected a source model diagnostic");
            } catch (org.hl7.fhir.exceptions.FHIRException expected) {
                assertTrue(expected.getMessage(), expected.getMessage().contains("source"));
            }
        }
    }

    @Test
    public void usesTheConfiguredHapiTerminologyServerForTranslationAndValidation() throws Exception {
        var calls = new java.util.concurrent.CopyOnWriteArrayList<String>();
        var bodies = new java.util.concurrent.CopyOnWriteArrayList<String>();
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/fhir", exchange -> {
            calls.add(exchange.getRequestURI() + "|" + exchange.getRequestHeaders().getFirst("Authorization"));
            String path = exchange.getRequestURI().getPath();
            if (path.endsWith("$translate")) bodies.add(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            String response;
            if (path.endsWith("$translate")) response = "{\"resourceType\":\"Parameters\",\"parameter\":[{\"name\":\"result\",\"valueBoolean\":true},{\"name\":\"match\",\"part\":[{\"name\":\"equivalence\",\"valueCode\":\"equivalent\"},{\"name\":\"concept\",\"valueCoding\":{\"system\":\"http://hl7.org/fhir/administrative-gender\",\"code\":\"female\"}}]}]}";
            else if (path.endsWith("$validate-code")) response = "{\"resourceType\":\"Parameters\",\"parameter\":[{\"name\":\"result\",\"valueBoolean\":true}]}";
            else if (path.endsWith("$lookup")) response = "{\"resourceType\":\"Parameters\",\"parameter\":[{\"name\":\"name\",\"valueString\":\"Remote\"},{\"name\":\"display\",\"valueString\":\"Remote code\"}]}";
            else response = "{\"resourceType\":\"Bundle\",\"type\":\"searchset\",\"entry\":[{\"resource\":{\"resourceType\":\"CodeSystem\",\"url\":\"http://example.org/remote\",\"status\":\"active\",\"content\":\"not-present\"}}]}";
            byte[] bytes = response.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/fhir+json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (var out = exchange.getResponseBody()) { out.write(bytes); }
        });
        server.start();
        try {
            Map<String, String> opts = new LinkedHashMap<>(options());
            opts.put("sourceModel", "fhir");
            opts.put("terminologyServer", "http://127.0.0.1:" + server.getAddress().getPort() + "/fhir");
            opts.put("authorization", "Bearer fml-test");
            opts.put("cacheSeconds", "0");
            opts.put("timeoutSeconds", "2");
            String map = "inline:map \"http://example.org/remote-map\" = \"Remote\"\n"
                    + "uses \"http://hl7.org/fhir/StructureDefinition/Patient\" alias Patient as source\n"
                    + "uses \"http://hl7.org/fhir/StructureDefinition/Patient\" alias PatientOut as target\n"
                    + "group Remote(source src : Patient, target tgt : PatientOut) { src.gender as c -> tgt.gender = translate(c, 'http://example.org/remote-map', 'code') \"gender\"; }";
            String input = "{\"resourceType\":\"Patient\",\"gender\":\"female\"}";
            assertEquals("female", JSON.readTree(bridge.transform(map, input, "json", Map.of(), Map.of(), opts)).path("gender").asText());
            assertTrue(calls.toString(), calls.stream().anyMatch(c -> c.contains("$translate") && c.endsWith("|Bearer fml-test")));
            JsonNode parameters = JSON.readTree(bodies.get(0)).path("parameter");
            assertTrue(parameters.toPrettyString(), java.util.stream.StreamSupport.stream(parameters.spliterator(), false)
                    .anyMatch(p -> "code".equals(p.path("name").asText()) && "female".equals(p.path("valueCode").asText())));
            assertFalse(bodies.get(0).contains("codeableConcept"));
            calls.clear();
            bridge.validate("{\"resourceType\":\"Patient\",\"maritalStatus\":{\"coding\":[{\"system\":\"http://example.org/remote\",\"code\":\"A\"}]}}", opts);
            assertTrue(calls.toString(), calls.stream().anyMatch(c -> c.contains("$validate-code") && c.endsWith("|Bearer fml-test")));
            var step = new fr.kazepoy.fhir.fml.FhirFmlTransformStep();
            step.setMapSource(map.substring("inline:".length()));
            step.setTerminologyServer(opts.get("terminologyServer"));
            step.setTerminologyAuthorization("'Bearer fml-test'");
            step.setCacheSeconds(0);
            step.setTimeoutSeconds(2);
            String request = JSON.writeValueAsString(Map.of("step", Map.of("mapSource", step.getMapSource(),
                    "terminologyServer", step.getTerminologyServer(), "terminologyAuthorization", step.getTerminologyAuthorization(),
                    "cacheSeconds", 0, "timeoutSeconds", 2), "inputMode", "prepared", "format", "json", "message", input));
            JsonNode preview = JSON.readTree(fr.kazepoy.fhir.fml.server.FmlTester.test(request, (type, message, properties) -> message));
            assertEquals(preview.toPrettyString(), 0, preview.path("errors").size());
            assertEquals("female", JSON.readTree(preview.path("output").asText()).path("gender").asText());
            Map<String, Object> trace = new LinkedHashMap<>();
            fr.kazepoy.fhir.fml.FmlFacade.run("Remote", map, input, "json", Map.of(), Map.of(), opts, true, trace);
            assertFalse(JSON.writeValueAsString(trace).contains("Bearer fml-test"));
            opts.put("authorization", "Bearer another-context");
            calls.clear();
            bridge.transform(map, input, "json", Map.of(), Map.of(), opts);
            assertTrue(calls.toString(), calls.stream().allMatch(c -> c.endsWith("|Bearer another-context")));
        } finally { server.stop(0); }
    }

    @Test
    public void copiesTheOriginalFmlTextIncludingCommentsAndImports() throws Exception {
        Map<String, String> opts = new LinkedHashMap<>(options());
        opts.put("profiles", Path.of("demo/fhir-volume/02-adt-patient-context").toAbsolutePath().toString());
        String original = Files.readString(Path.of("demo/fhir-volume/02-adt-patient-context/PatientToBundle.fml"));
        assertEquals(original, bridge.mapSource("http://example.org/fml-demo/StructureMap/PatientToBundle", opts));
        try {
            bridge.mapSource("http://example.org/missing", opts);
            fail("Expected a missing map diagnostic");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("not loaded"));
        }
    }

    @Test
    public void listsTheMapsOfTheProfileLocations() throws Exception {
        JsonNode list = JSON.readTree(bridge.listMaps(options()));
        assertEquals(2, list.path("maps").size());
        assertEquals(BUNDLE_MAP, list.path("maps").get(0).path("url").asText());
        assertEquals(0, list.path("errors").size());
    }

    @Test
    public void buildsTheGenericModelWithNamesPositionsAndOccurrences() throws Exception {
        Map<String, String> context = new LinkedHashMap<>();
        context.put("channelName", "ORU");
        context.put("dataType", "HL7V2");
        JsonNode model = JSON.readTree(bridge.source(oru, "xml", context, Map.of("site", "Marseille"), options()));
        assertEquals("HL7Message", model.path("name").asText());
        assertEquals("ORU", model.path("context").path("channelName").asText());
        assertEquals("Marseille", model.path("context").path("variable").get(0).path("value").asText());
        JsonNode pid = null;
        for (JsonNode node : model.path("node")) if ("PID".equals(node.path("name").asText())) pid = node;
        assertNotNull(pid);
        assertEquals(2, pid.path("position").asInt()); // second segment
        JsonNode name = pid.path("node").get(4);
        assertEquals("PID.5", name.path("name").asText());
        assertEquals(5, name.path("position").asInt());
        assertEquals("MARTIN", name.path("node").get(0).path("value").asText());
        assertTrue(pid.path("node").get(1).path("value").isMissingNode()); // empty PID.2
    }

    @Test
    public void transformsAMessageToAPatientWithTranslation() throws Exception {
        JsonNode patient = JSON.readTree(bridge.transform(PATIENT_MAP, oru, "xml", Map.of(), Map.of(), options()));
        assertEquals("Patient", patient.path("resourceType").asText());
        assertEquals("100001", patient.path("identifier").get(0).path("value").asText());
        assertEquals("MARTIN", patient.path("name").get(0).path("family").asText());
        assertEquals("CLAIRE", patient.path("name").get(0).path("given").get(0).asText());
        assertEquals("1980-02-15", patient.path("birthDate").asText());
        assertEquals("female", patient.path("gender").asText());
    }

    @Test
    public void transformsToABundleWithImportsAndChoiceTypes() throws Exception {
        JsonNode bundle = JSON.readTree(bridge.transform(BUNDLE_MAP, oru, "xml", Map.of(), Map.of(), options()));
        assertEquals("transaction", bundle.path("type").asText());
        assertEquals("Patient", bundle.path("entry").get(0).path("resource").path("resourceType").asText());
        assertEquals("MARTIN", bundle.path("entry").get(0).path("resource").path("name").get(0).path("family").asText());
        JsonNode observation = bundle.path("entry").get(1).path("resource");
        assertEquals("Observation", observation.path("resourceType").asText());
        assertEquals("GLU", observation.path("code").path("coding").get(0).path("code").asText());
        assertEquals("mmol/L", observation.path("valueQuantity").path("unit").asText());
        assertEquals(5.1, observation.path("valueQuantity").path("value").asDouble(), 0.0001);
    }

    @Test
    public void concurrentGenericAndLogicalTransformsDoNotContaminateEachOther() throws Exception {
        String orderJson = Files.readString(Path.of("demo/oie-init/data/samples/06-json-order-to-dispatch/input.json"));
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            List<Callable<String>> work = new ArrayList<>();
            for (int i = 0; i < 24; i++) {
                final boolean logical = i % 2 == 0;
                work.add(() -> bridge.transform(logical ? ORDER_MAP : PATIENT_MAP, logical ? orderJson : oru,
                        logical ? "json" : "xml", Map.of(), Map.of(),
                        logical ? logicalOrderOptions() : options()));
            }
            List<Future<String>> results = pool.invokeAll(work);
            for (int i = 0; i < results.size(); i++) {
                JsonNode output = JSON.readTree(results.get(i).get());
                if (i % 2 == 0) {
                    assertEquals("express", output.path("priorite").asText());
                } else {
                    assertEquals("Patient", output.path("resourceType").asText());
                    assertEquals("female", output.path("gender").asText());
                }
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    public void mapsAnInboundFhirResourceWithoutWrappingItInOieMessage() throws Exception {
        String map = "map \"http://example.org/CopyPatient\" = \"CopyPatient\"\n"
                + "uses \"http://hl7.org/fhir/StructureDefinition/Patient\" alias Patient as source\n"
                + "uses \"http://hl7.org/fhir/StructureDefinition/Patient\" alias Target as target\n"
                + "group CopyPatient(source src : Patient, target tgt : Target) { src.active as active -> tgt.active = active \"active\"; }\n";
        Map<String, String> fhir = options();
        fhir.put("sourceModel", "fhir");
        JsonNode output = JSON.readTree(bridge.transform(FmlBridge.INLINE + map,
                "{\"resourceType\":\"Patient\",\"active\":true}", "json", Map.of(), Map.of(), fhir));
        assertTrue(output.path("active").asBoolean());
    }

    @Test
    public void namesAnUnknownMap() throws Exception {
        try {
            bridge.transform("http://example.org/unknown", oru, "xml", Map.of(), Map.of(), options());
            fail("Expected an unknown map error");
        } catch (IllegalArgumentException e) {
            assertTrue(e.getMessage().contains("http://example.org/unknown"));
        }
    }

    @Test
    public void runsAMapWrittenInTheStepAndChecksIt() throws Exception {
        String text = Files.readString(Path.of(fixture("fml/maps/OruPatient.fml")));
        JsonNode patient = JSON.readTree(bridge.transform(FmlBridge.INLINE + text, oru, "xml", Map.of(), Map.of(), options()));
        assertEquals("Patient", patient.path("resourceType").asText());
        assertEquals(JSON.readTree(bridge.transform(PATIENT_MAP, oru, "xml", Map.of(), Map.of(), options())), patient);

        JsonNode ok = JSON.readTree(bridge.check(text, options()));
        assertEquals(PATIENT_MAP, ok.path("url").asText());
        assertEquals(ok.toPrettyString(), 0, ok.path("errors").size());

        JsonNode broken = JSON.readTree(bridge.check(text.replaceFirst("group ", "groupe "), options()));
        assertEquals(1, broken.path("errors").size());
        assertTrue(broken.path("errors").get(0).path("line").asInt() >= 1);
        assertFalse(broken.path("errors").get(0).path("message").asText().isEmpty());

        JsonNode unknown = JSON.readTree(bridge.check(text.replace("StructureDefinition/OieMessage", "StructureDefinition/Missing"), options()));
        assertTrue(unknown.path("errors").get(0).path("message").asText().contains("Missing"));
    }

    @Test
    public void runsDemoPermissionR5MapAndIgPackagedStructureMap() throws Exception {
        FhirSerializationProperties r5Props = new FhirSerializationProperties();
        r5Props.setFhirVersion(FhirSerializationProperties.FhirVersion.R5);
        r5Props.setProfiles(Path.of("demo/fhir-volume/07-csv-permission-r5/CsvToPermissionR5.fml").toAbsolutePath().toString());
        Map<String, String> r5Opts = r5Props.engineOptions();
        String delimitedXml = "<delimited>"
                + "<row><column1>permission_id</column1><column2>status</column2><column3>combining</column3>"
                + "<column4>org_id</column4><column5>org_name</column5><column6>rule_type</column6><column7>action_code</column7></row>"
                + "<row><column1>perm-r5-001</column1><column2>active</column2><column3>deny-overrides</column3>"
                + "<column4>org-r5-demo</column4><column5>Centre Hospitalier Demo</column5><column6>permit</column6><column7>access</column7></row>"
                + "</delimited>";
        JsonNode r5Bundle = JSON.readTree(bridge.transform(
                "http://example.org/fhir/r5/StructureMap/CsvToPermissionR5", delimitedXml, "xml", Map.of(), Map.of(), r5Opts));
        JsonNode expectedBundle = JSON.readTree(Files.readString(Path.of("examples/csv/permissions-r5-expected.json")));
        assertEquals(expectedBundle, r5Bundle);
        assertTrue(fr.kazepoy.fhir.mapper.integration.FhirDataTypeAdapter.validate(
                r5Bundle.toString(), "", "", "R5").isValid());

        FhirSerializationProperties igProps = new FhirSerializationProperties();
        igProps.setFhirVersion(FhirSerializationProperties.FhirVersion.R4);
        igProps.setProfiles(Path.of("demo/fhir-volume/08-oru-patient-structuremap").toAbsolutePath()
                + ";" + Path.of("demo/fhir-volume/shared/lab-r4").toAbsolutePath());
        JsonNode igPatient = JSON.readTree(bridge.transform(
                "http://example.org/fhir/oru2fhir/StructureMap/OruR01ToPatientIG",
                oru, "xml", Map.of(), Map.of(), igProps.engineOptions()));
        JsonNode expectedPatient = JSON.readTree(Files.readString(Path.of("examples/hl7v2/oru-r01-minimal-expected.json")));
        assertEquals(expectedPatient, igPatient);
    }

    @Test
    public void supportsConcurrentInlineTransformsAndClearCaches() throws Exception {
        FhirSerializationProperties props = new FhirSerializationProperties();
        props.setFhirVersion(FhirSerializationProperties.FhirVersion.R4);
        Map<String, String> opts = props.engineOptions();
        String map = "inline:map \"http://example.org/concurrent\" = \"Concurrent\"\n"
                + "uses \"http://oie.org/fhir/StructureDefinition/OieMessage\" alias OieMessage as source\n"
                + "uses \"http://hl7.org/fhir/StructureDefinition/Patient\" alias Patient as target\n"
                + "group Concurrent(source src : OieMessage, target patient : Patient) {\n"
                + "  src.value as v -> patient.id = v \"id\";\n"
                + "}";
        var pool = java.util.concurrent.Executors.newFixedThreadPool(4);
        List<java.util.concurrent.Future<?>> futures = new java.util.ArrayList<>();
        for (int t = 0; t < 4; t++) {
            final int worker = t;
            futures.add(pool.submit(() -> {
                for (int i = 0; i < 15; i++) {
                    String out = bridge.transform(map, "p-" + worker + "-" + i, "raw", Map.of(), Map.of(), opts);
                    assertEquals("p-" + worker + "-" + i, JSON.readTree(out).get("id").asText());
                    if (i % 5 == 0) bridge.clearCaches();
                }
                return null;
            }));
        }
        pool.shutdown();
        for (var f : futures) f.get(30, java.util.concurrent.TimeUnit.SECONDS);
    }

    @Test
    public void generatesMissingSnapshotsAndResolvesUsesWithoutAlias() throws Exception {
        FhirSerializationProperties props = new FhirSerializationProperties();
        props.setFhirVersion(FhirSerializationProperties.FhirVersion.R4);
        props.setProfiles(fixture("profiles"));
        String map = "inline:map \"http://example.org/DiffProfile\" = \"DiffProfile\"\n"
                + "uses \"http://oie.org/fhir/StructureDefinition/OieMessage\" as source\n"
                + "uses \"http://example.org/fhir/StructureDefinition/patient-with-birthdate\" as target\n"
                + "group main(source src : OieMessage, target tgt : PatientWithBirthDate) {\n"
                + "  src.value as v -> tgt.birthDate = v \"birthDate\";\n"
                + "}";
        JsonNode patient = JSON.readTree(bridge.transform(map, "1980-01-15", "raw", Map.of(), Map.of(), props.engineOptions()));
        assertEquals("Patient", patient.path("resourceType").asText());
        assertEquals("1980-01-15", patient.path("birthDate").asText());
    }

    @Test
    public void preservesDataTypeContextForOieMessage() throws Exception {
        JsonNode strictSource = JSON.readTree(bridge.source(strictOru, "xml", Map.of(), Map.of(), options()));
        assertEquals("HL7V2", strictSource.path("context").path("dataType").asText());
        JsonNode explicitContext = JSON.readTree(bridge.source("<custom/>", "xml", Map.of("dataType", "HL7V2"), Map.of(), options()));
        assertEquals("HL7V2", explicitContext.path("context").path("dataType").asText());
    }
}
