/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.fml;

import static org.junit.Assert.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import org.junit.Test;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import fr.kazepoy.fhir.fml.server.FmlServicePlugin;
import fr.kazepoy.fhir.fml.server.FmlTester;
import fr.kazepoy.fhir.mapper.util.FhirJson;

import com.mirth.connect.model.Channel;
import com.mirth.connect.model.InvalidChannel;
import com.mirth.connect.model.converters.ObjectXMLSerializer;
import com.mirth.connect.util.ScriptBuilderException;

/** The step as OIE runs it: its script in Rhino with E4X, its test and its serialization. */
public class FhirFmlTransformStepTest {
    private static final String PATIENT_MAP = "http://example.org/fhir/StructureMap/OruPatient";

    private static String fixture(String name) { return Path.of("src/test/resources", name).toAbsolutePath().toString(); }

    private static String profiles() { return fixture("fml/maps") + ";" + fixture("conceptmaps/v2-sex-r4.json"); }

    private static FhirFmlTransformStep step() {
        FhirFmlTransformStep step = new FhirFmlTransformStep();
        step.setName("Patient");
        step.setSourceModel("oie-message");
        step.setProfiles(profiles());
        step.setMapUrl(PATIENT_MAP);
        return step;
    }

    /** Runs a script as a transformer would: msg is the E4X message, tmp absent. */
    private static Map<String, Object> run(String script, Map<String, Object> channelMap) throws Exception {
        String oru = Files.readString(Path.of(fixture("fml/messages/oru-r01-minimal.xml"))).replaceFirst("^<\\?xml[^>]*>", "");
        return run(script, channelMap, oru, false);
    }

    private static Map<String, Object> run(String script, Map<String, Object> channelMap, String input, boolean json) throws Exception {
        Context cx = Context.enter();
        try {
            cx.setLanguageVersion(Context.VERSION_DEFAULT);
            Scriptable scope = cx.initStandardObjects();
            scope.put("channelMap", scope, Context.javaToJS(channelMap, scope));
            scope.put("__oru", scope, input);
            Object out = cx.evaluateString(scope, "var msg = " + (json ? "JSON.parse(__oru)" : "new XML(__oru)")
                    + ";\nfunction $(name) { return channelMap.get(name); }\nfunction doTransform() {\n" + script
                    + "\n}\ndoTransform();\ntypeof msg === 'xml' ? null : String(msg);", "step", 1, null);
            Map<String, Object> result = new HashMap<>();
            result.put("msg", out == null ? null : Context.toString(out));
            return result;
        } finally {
            Context.exit();
        }
    }

    @Test
    public void dynamicMapAndLogicalModelAreResolvedPerMessageAndTraced() throws Exception {
        FhirFmlTransformStep step = new FhirFmlTransformStep();
        step.setProfiles(fixture("fml/dynamic"));
        step.setSourceModel("logical");
        step.setMapUrl("${fmlMapUrl}");
        step.setSourceModelUrl("${fmlSourceModelUrl}");
        step.setValidateOutput(false);
        step.setTraceMessages(true);
        step.setSequenceNumber("0");
        String script = step.getScript(false);
        Map<String, Object> channelMap = new HashMap<>();
        for (String event : List.of("AdtA28", "AdtA31")) {
            String map = "http://example.org/fhir/StructureMap/" + event;
            String model = "http://example.org/fhir/StructureDefinition/" + event;
            channelMap.put("fmlMapUrl", map);
            channelMap.put("fmlSourceModelUrl", model);
            String input = FhirJson.write(Map.of(event.equals("AdtA28") ? "patientId" : "identifier", event));
            Map<?, ?> output = (Map<?, ?>) FhirJson.parse(run(script, channelMap, input, true).get("msg").toString());
            assertEquals(event, output.get("id"));
            Map<?, ?> trace = (Map<?, ?>) FhirJson.parse(channelMap.get("FML_TRACE_D0_S0").toString());
            assertEquals(map, trace.get("mapReference"));
            assertEquals(model, trace.get("sourceModelUrl"));
            assertEquals(map, ((Map<?, ?>) trace.get("parameters")).get("mapReference"));
        }
        assertEquals("${fmlMapUrl}", step.getMapUrl());
        assertEquals("${fmlSourceModelUrl}", step.getSourceModelUrl());
        channelMap.remove("fmlSourceModelUrl");
        try {
            run(script, channelMap, "{}", true);
            fail("Expected missing logical model variable");
        } catch (Exception expected) {
            assertTrue(expected.toString(), expected.toString().contains("fmlSourceModelUrl"));
            Map<?, ?> trace = (Map<?, ?>) FhirJson.parse(channelMap.get("FML_TRACE_D0_S0").toString());
            assertEquals("error", trace.get("status"));
            assertEquals("configuration", trace.get("phase"));
        }
    }

    @Test
    public void dynamicTesterUsesExplicitVariablesAndReportsResolvedReferences() {
        Map<String, Object> step = Map.of("profiles", fixture("fml/dynamic"), "sourceModel", "logical",
                "mapUrl", "${fmlMapUrl}", "sourceModelUrl", "${fmlSourceModelUrl}", "validateOutput", false);
        for (String event : List.of("AdtA28", "AdtA31")) {
            String map = "http://example.org/fhir/StructureMap/" + event;
            String model = "http://example.org/fhir/StructureDefinition/" + event;
            String request = FhirJson.write(Map.of("step", step, "inputMode", "prepared", "format", "json",
                    "message", FhirJson.write(Map.of(event.equals("AdtA28") ? "patientId" : "identifier", event)),
                    "variables", Map.of("fmlMapUrl", map, "fmlSourceModelUrl", model)));
            Map<?, ?> result = (Map<?, ?>) FhirJson.parse(FmlTester.test(request, (type, message, properties) -> message));
            assertEquals(result.toString(), List.of(), result.get("errors"));
            assertEquals(event, ((Map<?, ?>) FhirJson.parse(result.get("output").toString())).get("id"));
            assertEquals(Map.of("mapUrl", map, "sourceModelUrl", model), result.get("resolvedReferences"));
        }
        Map<?, ?> result = (Map<?, ?>) FhirJson.parse(FmlTester.test(FhirJson.write(Map.of("step", step, "message", "{}")),
                (type, message, properties) -> message));
        assertTrue(result.toString(), result.get("errors").toString().contains("fmlMapUrl"));
        assertSame(FhirJson.NULL, result.get("model"));
    }

    @Test
    public void referenceResolutionPreservesFixedAndInlineMapsAndRejectsMissingValues() {
        String inline = "inline: literal ${notAVariable}";
        Map<String, String> options = Map.of("mapReference", inline, "sourceModel", "fhir", "sourceModelUrl", "${ignored}");
        assertEquals(options, FmlFacade.resolveReferences(options, Map.of()));
        assertEquals(PATIENT_MAP, FmlFacade.resolveReferences(Map.of("mapReference", PATIENT_MAP), Map.of()).get("mapReference"));
        for (Map<String, String> variables : List.of(Map.<String, String>of(), Map.of("map", "  "), Map.of("map", "inline: injected"))) {
            try {
                FmlFacade.resolveReferences(Map.of("mapReference", "${map}"), variables);
                fail("Expected invalid reference variable");
            } catch (IllegalArgumentException expected) {
                assertTrue(expected.getMessage(), expected.getMessage().contains("map"));
            }
        }
    }

    @Test
    public void aNamedContextSuppliesValidationUnlessTheStepOverridesIt() {
        try {
            fr.kazepoy.fhir.mapper.FhirMapperSettings.configureSource(null, null);
            fr.kazepoy.fhir.mapper.FhirMapperSettings.load("{\"contexts\":[{\"name\":\"local-test\",\"fhirVersion\":\"R4B\",\"packages\":[\"/test\"],\"validation\":\"off\"}]}");
            FhirFmlTransformStep step = new FhirFmlTransformStep();
            step.setContext("local-test");
            step.setValidateOutput(true);
            assertEquals("R4B", step.effectiveFhirVersion());
            assertEquals("/test", step.effectiveProfiles());
            step.setTerminologyServer("http://local-tx");
            assertEquals("", step.engineOptions().get("terminologyServer"));
            assertFalse(step.isValidateOutput());
            step = new FhirFmlTransformStep(step);
            step.setContext("");
            assertEquals("http://local-tx", step.engineOptions().get("terminologyServer"));
            assertTrue(step.isValidateOutput());
            fr.kazepoy.fhir.mapper.FhirMapperSettings.load("{\"contexts\":[{\"name\":\"local-test\",\"validation\":\"always\"}]}");
            step.setContext("local-test");
            step.setValidateOutput(false);
            assertTrue(step.isValidateOutput());
            step.setValidationOverride(false);
            assertFalse(step.isValidateOutput());
            step = new FhirFmlTransformStep(step);
            assertFalse(step.isValidateOutput());
            step.setValidationOverride(null);
            assertTrue(step.isValidateOutput());
            step.setValidationOverride(true);
            assertTrue(step.isValidateOutput());
        } finally {
            fr.kazepoy.fhir.mapper.FhirMapperSettings.load(null);
        }
    }

    @Test
    public void runsTheMapOnTheE4xMessageAndPublishesTheResource() throws Exception {
        Map<String, Object> result = run(step().getScript(false), new HashMap<>());
        Map<?, ?> patient = (Map<?, ?>) FhirJson.parse((String) result.get("msg"));
        assertEquals("Patient", patient.get("resourceType"));
        assertEquals("female", patient.get("gender"));
    }

    @Test
    public void traceCapturesTheActualSourceAndValidationInTheMessageMap() throws Exception {
        FhirFmlTransformStep step = step();
        step.setSequenceNumber("2");
        step.setTraceMessages(true);
        Map<String, Object> channelMap = new HashMap<>();
        run(step.getScript(false), channelMap);
        Map<?, ?> trace = (Map<?, ?>) FhirJson.parse(channelMap.get("FML_TRACE_D0_S2").toString());
        assertEquals("success", trace.get("status"));
        assertEquals(true, trace.get("validationPerformed"));
        assertTrue(trace.get("input").toString().contains("PID"));
        assertEquals("OieMessage", ((Map<?, ?>) trace.get("fmlSource")).get("resourceType"));
        assertEquals("Patient", ((Map<?, ?>) trace.get("output")).get("resourceType"));
        assertTrue(Double.parseDouble(trace.get("durationMs").toString()) >= 0);
    }

    @Test
    public void traceDistinguishesInvalidOutputFromValidationDisabled() throws Exception {
        FhirFmlTransformStep step = step();
        step.setSequenceNumber("1");
        step.setTraceMessages(true);
        step.setMapSource("map \"http://example.org/invalid\" = \"Invalid\"\n"
                + "uses \"https://openintegrationengine.org/fhir/StructureDefinition/OieMessage\" alias OieMessage as source\n"
                + "uses \"http://hl7.org/fhir/StructureDefinition/Patient\" alias Patient as target\n"
                + "group Invalid(source src : OieMessage, target tgt : Patient) { src -> tgt.gender = 'invalid' \"gender\"; }");
        Map<String, Object> channelMap = new HashMap<>();
        try {
            run(step.getScript(false), channelMap);
            fail("Expected validation failure");
        } catch (Exception expected) {
            Map<?, ?> trace = (Map<?, ?>) FhirJson.parse(channelMap.get("FML_TRACE_D0_S1").toString());
            assertEquals("validation", trace.get("phase"));
            assertEquals(true, trace.get("validationPerformed"));
            assertFalse(((List<?>) trace.get("issues")).isEmpty());
            assertNotNull(trace.get("output"));
        }
        step.setValidationOverride(false);
        run(step.getScript(false), channelMap);
        Map<?, ?> trace = (Map<?, ?>) FhirJson.parse(channelMap.get("FML_TRACE_D0_S1").toString());
        assertEquals("success", trace.get("status"));
        assertEquals(false, trace.get("validationPerformed"));
    }

    @Test
    public void traceSurvivesFailureAndIsAbsentWhenDisabled() throws Exception {
        Map<String, Object> channelMap = new HashMap<>();
        run(step().getScript(false), channelMap);
        assertTrue(channelMap.isEmpty());
        FhirFmlTransformStep step = step();
        step.setSequenceNumber("0");
        step.setTraceMessages(true);
        step.setMapUrl("http://example.org/missing");
        try {
            run(step.getScript(false), channelMap);
            fail("Expected failure");
        } catch (Exception expected) {
            Map<?, ?> trace = (Map<?, ?>) FhirJson.parse(channelMap.get("FML_TRACE_D0_S0").toString());
            assertEquals("error", trace.get("status"));
            assertEquals("map", trace.get("phase"));
            assertTrue(trace.get("error").toString().contains("missing"));
            assertNotNull(trace.get("input"));
        }
        FhirFmlTransformStep parsed = FhirFmlTransformStep.fromJson("{\"traceMessages\":true,\"validationOverride\":false}");
        assertTrue(new FhirFmlTransformStep(parsed).isTraceMessages());
        assertFalse(parsed.isValidateOutput());
        assertNull(FhirFmlTransformStep.fromJson("{\"validationOverride\":null}").getValidationOverride());
    }

    @Test
    public void publishesToAChannelMapVariable() throws Exception {
        FhirFmlTransformStep step = step();
        step.setVariable("patient");
        Map<String, Object> channelMap = new HashMap<>();
        Map<String, Object> result = run(step.getScript(false), channelMap);
        assertNull(result.get("msg")); // msg stays the inbound E4X message
        assertTrue(channelMap.get("patient").toString().contains("\"family\":\"MARTIN\""));
    }

    @Test
    public void stopsTheMessageWhenTheMapIsUnknown() throws Exception {
        FhirFmlTransformStep step = step();
        step.setMapUrl("http://example.org/unknown");
        try {
            run(step.getScript(false), new HashMap<>());
            fail("Expected the step to fail");
        } catch (Exception e) {
            assertTrue(e.getMessage(), e.getMessage().contains("http://example.org/unknown"));
        }
    }

    @Test(expected = ScriptBuilderException.class)
    public void needsAMap() throws Exception {
        new FhirFmlTransformStep().getScript(false);
    }

    @Test
    public void jsonNullOptionalStringsUseTheSameDefaultsAsAbsentProperties() {
        FhirFmlTransformStep step = FhirFmlTransformStep.fromJson("{\"context\":null,\"profiles\":null,\"mapUrl\":null,"
                + "\"mapSource\":null,\"sourceModel\":null,\"sourceModelUrl\":null,\"variable\":null,"
                + "\"contextVariables\":null,\"fhirVersion\":null,\"name\":null,\"sequenceNumber\":null}");
        assertEquals("", step.getContext());
        assertEquals("", step.effectiveProfiles());
        assertEquals("", step.mapReference());
        assertEquals("fhir", step.getSourceModel());
        assertEquals("", step.getSourceModelUrl());
        assertEquals("", step.getVariable());
        assertEquals(List.of(), step.contextVariableNames());
        assertEquals("R4", step.effectiveFhirVersion());
        assertEquals("", step.getName());
        assertEquals("", step.getSequenceNumber());
    }

    @Test
    public void testsAStepOnASampleMessage() throws Exception {
        String oru = Files.readString(Path.of(fixture("fml/messages/oru-r01-minimal.xml")));
        String request = FhirJson.write(Map.of("step", Map.of("sourceModel", "oie-message", "mapUrl", PATIENT_MAP, "profiles", profiles(), "validateOutput", true),
                "message", oru, "dataType", "XML"));
        Map<?, ?> answer = (Map<?, ?>) FhirJson.parse(FmlTester.test(request, (type, message, properties) -> message));
        assertEquals(List.of(), answer.get("errors"));
        assertEquals(true, answer.get("validationPerformed"));
        assertTrue(answer.get("output").toString().contains("\"birthDate\":\"1980-02-15\""));
        Map<?, ?> context = (Map<?, ?>) ((Map<?, ?>) answer.get("model")).get("context");
        assertEquals("HL7V2", context.get("dataType"));
    }

    @Test
    public void preparedXmlBypassesTheSummaryParser() throws Exception {
        String oru = Files.readString(Path.of(fixture("fml/messages/oru-r01-minimal.xml")));
        String request = FhirJson.write(Map.of("step", Map.of("sourceModel", "oie-message", "mapUrl", PATIENT_MAP, "profiles", profiles()),
                "message", oru, "inputMode", "prepared", "format", "xml", "dataType", "HL7V2"));
        Map<?, ?> answer = (Map<?, ?>) FhirJson.parse(FmlTester.test(request, (type, message, properties) -> {
            fail("A prepared message must not be parsed again.");
            return "";
        }));
        assertEquals(List.of(), answer.get("errors"));
        assertTrue(answer.get("output").toString().contains("\"birthDate\":\"1980-02-15\""));
    }

    @Test
    public void rawSamplesPassAllSummaryPropertiesToTheParser() throws Exception {
        String oru = Files.readString(Path.of(fixture("fml/messages/oru-r01-minimal.xml")));
        Map<String, Object> properties = Map.of("serializationProperties", Map.of("useStrictParser", true),
                "deserializationProperties", Map.of("useStrictValidation", false));
        String request = FhirJson.write(Map.of("step", Map.of("sourceModel", "oie-message", "mapUrl", PATIENT_MAP, "profiles", profiles()),
                "message", "original", "inputMode", "raw", "dataType", "HL7V2", "dataTypeProperties", properties));
        Map<?, ?> answer = (Map<?, ?>) FhirJson.parse(FmlTester.test(request, (type, message, received) -> {
            assertEquals("HL7V2", type);
            assertEquals("original", message);
            assertEquals(properties, received);
            return oru;
        }));
        assertEquals(List.of(), answer.get("errors"));
        assertTrue(answer.get("output").toString().contains("\"birthDate\":\"1980-02-15\""));
    }

    @Test
    public void preparedJsonAndTextKeepTheirDeclaredShape() {
        String map = "map \"http://example.org/prepared\" = \"Prepared\"\n"
                + "uses \"https://openintegrationengine.org/fhir/StructureDefinition/OieMessage\" alias OieMessage as source\n"
                + "uses \"http://hl7.org/fhir/StructureDefinition/Patient\" alias Patient as target\n"
                + "group Prepared(source src : OieMessage, target patient : Patient) { "
                + "src.value as v -> patient.id = v \"id\"; }";
        for (String format : List.of("json", "raw")) {
            String request = FhirJson.write(Map.of("step", Map.of("sourceModel", "oie-message", "mapSource", map, "validateOutput", false),
                    "message", "json".equals(format) ? "\"prepared\"" : "prepared", "inputMode", "prepared", "format", format));
            Map<?, ?> answer = (Map<?, ?>) FhirJson.parse(FmlTester.test(request, (type, message, properties) -> {
                fail("A prepared message must not be parsed again.");
                return "";
            }));
            assertEquals(List.of(), answer.get("errors"));
            assertEquals("prepared", ((Map<?, ?>) FhirJson.parse(answer.get("output").toString())).get("id"));
        }
    }

    @Test
    public void theDemoMapMakesAValidExampleLabPatient() throws Exception {
        String oru = Files.readString(Path.of(fixture("fml/messages/oru-r01-minimal.xml")));
        String ig = Path.of("demo", "fhir-volume", "shared", "lab-r4").toAbsolutePath().toString();
        String fml = Path.of("src", "test", "resources", "fml", "OruR01ToPatient.fml").toAbsolutePath().toString();
        String request = FhirJson.write(Map.of("step", Map.of("sourceModel", "oie-message", "mapUrl", "http://example.org/fhir/oru2fhir/StructureMap/OruR01ToPatient",
                "profiles", ig + ";" + fml, "validateOutput", true), "message", oru, "dataType", "XML"));
        Map<?, ?> answer = (Map<?, ?>) FhirJson.parse(FmlTester.test(request, (type, message, properties) -> message));
        assertEquals(List.of(), answer.get("errors"));
        List<?> errors = ((List<?>) answer.get("issues")).stream().filter(i -> List.of("error", "fatal").contains(((Map<?, ?>) i).get("severity"))).toList();
        assertEquals(List.of(), errors);
        Map<?, ?> patient = (Map<?, ?>) FhirJson.parse(answer.get("output").toString());
        Map<?, ?> name = (Map<?, ?>) ((List<?>) patient.get("name")).get(0);
        assertEquals("official", name.get("use"));
        assertEquals(List.of("CLAIRE", "ANNE"), name.get("given"));
        assertEquals("female", patient.get("gender"));
        assertEquals("http://example.org/fhir/oru2fhir/sid/ipp", ((Map<?, ?>) ((List<?>) patient.get("identifier")).get(0)).get("system"));
    }

    @Test
    public void reportsTheFailingPhaseOfATest() {
        String request = FhirJson.write(Map.of("step", Map.of("sourceModel", "oie-message", "mapUrl", "http://example.org/unknown", "profiles", profiles()),
                "message", "<HL7Message/>", "dataType", "XML"));
        Map<?, ?> answer = (Map<?, ?>) FhirJson.parse(FmlTester.test(request, (type, message, properties) -> message));
        Map<?, ?> error = (Map<?, ?>) ((List<?>) answer.get("errors")).get(0);
        assertEquals("transform", error.get("phase"));
    }

    @Test
    public void theDemoSummaryProjectsAFhirPatientAndKeepsFalseValues() throws Exception {
        Path examples = Path.of("examples/json");
        String ig = Path.of("demo", "fhir-volume", "shared", "lab-r4").toAbsolutePath().toString();
        String fml = Path.of("src", "test", "resources", "fml", "PatientSummary.fml").toAbsolutePath().toString();
        Map<String, Object> step = Map.of("name", "Résumé Patient", "mapUrl",
                "http://example.org/fhir/oru2fhir/StructureMap/PatientSummary", "profiles", ig + ";" + fml,
                "sourceModel", "fhir", "fhirVersion", "R4", "validateOutput", true);
        String request = FhirJson.write(Map.of("step", step, "dataType", "JSON",
                "message", Files.readString(examples.resolve("patient-fhir-source.json"))));
        Map<?, ?> answer = (Map<?, ?>) FhirJson.parse(FmlTester.test(request, (type, message, properties) -> message));
        assertEquals(List.of(), answer.get("errors"));
        assertEquals(true, answer.get("validationPerformed"));
        assertEquals(FhirJson.parse(Files.readString(examples.resolve("patient-fhir-source-expected.json"))),
                FhirJson.parse(answer.get("output").toString()));
        assertFalse(((List<?>) answer.get("issues")).stream()
                .anyMatch(i -> List.of("error", "fatal").contains(((Map<?, ?>) i).get("severity"))));
    }

    @Test
    public void pluginInitializationAllowsTheStepInAnOieChannel() throws Exception {
        ObjectXMLSerializer serializer = ObjectXMLSerializer.getInstance();
        if (serializer.getNormalizedVersion() == null) serializer.init("4.7.0");
        serializer.allowTypes(List.of(), List.of("com.mirth.connect.**"), List.of());
        new FmlServicePlugin().init(new Properties());
        String type = FhirFmlTransformStep.class.getName();
        String xml = "<channel version=\"4.7.0\"><id>fml</id><name>FML</name><revision>1</revision>"
                + "<sourceConnector version=\"4.7.0\"><metaDataId>0</metaDataId><transformer version=\"4.7.0\"><elements><" + type
                + " version=\"4.7.0\"><name>Patient</name><mapUrl>" + PATIENT_MAP + "</mapUrl>"
                + "<sourceModel>logical</sourceModel><sourceModelUrl>http://example.org/ORU</sourceModelUrl>"
                + "<sampleMessage> &lt;patient/&gt;\n</sampleMessage><sampleFormat>xml</sampleFormat>"
                + "<sampleVariables>{&quot;fmlMapUrl&quot;:&quot;http://example.org/test-map&quot;}</sampleVariables>"
                + "<validateOutput>false</validateOutput></" + type
                + "></elements></transformer></sourceConnector></channel>";
        Channel channel = serializer.deserialize(xml, Channel.class);
        assertFalse(channel instanceof InvalidChannel ? ((InvalidChannel) channel).getCause().toString() : "", channel instanceof InvalidChannel);
        Channel roundTrip = serializer.deserialize(serializer.serialize(channel), Channel.class);
        FhirFmlTransformStep step = (FhirFmlTransformStep) roundTrip.getSourceConnector().getTransformer().getElements().get(0);
        assertEquals(PATIENT_MAP, step.getMapUrl());
        assertEquals("logical", step.getSourceModel());
        assertEquals("http://example.org/ORU", step.getSourceModelUrl());
        assertFalse(step.isValidateOutput());
        assertEquals(" <patient/>\n", step.getSampleMessage());
        assertEquals("xml", step.getSampleFormat());
        assertEquals("{\"fmlMapUrl\":\"http://example.org/test-map\"}", step.getSampleVariables());
        assertEquals(step.getSampleVariables(), new FhirFmlTransformStep(step).getSampleVariables());
        assertEquals(step.getSampleMessage(), new FhirFmlTransformStep(step).getSampleMessage());
        String retiredType = "org." + "oie.fhir.fml.FhirFmlTransformStep";
        Channel oldNamespace = serializer.deserialize(xml.replace(type, retiredType), Channel.class);
        assertTrue(oldNamespace instanceof InvalidChannel);
        Channel legacy = serializer.deserialize(xml.replace("<validateOutput>false</validateOutput>", ""), Channel.class);
        assertTrue(((FhirFmlTransformStep) legacy.getSourceConnector().getTransformer().getElements().get(0)).isValidateOutput());
    }

    @Test
    public void newStepsDefaultToFhirAndUnknownModesAreRejected() {
        assertEquals("fhir", new FhirFmlTransformStep().getSourceModel());
        try {
            new FhirFmlTransformStep().setSourceModel("unknown");
            fail("Expected an unsupported source model error");
        } catch (IllegalArgumentException e) {
            assertTrue(e.getMessage().contains("unknown"));
        }
    }

    @Test
    public void terminologyAuthorizationSupportsLineCommentsAndSandboxesTesterEvaluation() throws Exception {
        FhirFmlTransformStep step = new FhirFmlTransformStep();
        step.setMapUrl(PATIENT_MAP);
        step.setTerminologyAuthorization("'Bearer x' // trailing comment");
        String script = step.getScript(false);
        assertTrue(script, script.contains("'Bearer x' // trailing comment\n); })())"));

        String oru = Files.readString(Path.of(fixture("fml/messages/oru-r01-minimal.xml")));
        String blockedJava = FhirJson.write(Map.of(
                "step", Map.of("sourceModel", "oie-message", "mapUrl", PATIENT_MAP, "profiles", profiles(),
                        "terminologyAuthorization", "java.lang.System.getProperty('user.home')"),
                "message", oru, "dataType", "XML"));
        Map<?, ?> answer = (Map<?, ?>) FhirJson.parse(FmlTester.test(blockedJava, (type, message, properties) -> message));
        List<?> errors = (List<?>) answer.get("errors");
        assertEquals(1, errors.size());
        assertTrue(errors.get(0).toString(), errors.get(0).toString().contains("java"));
    }
}
