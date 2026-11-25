/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.mapper.server;

import static org.junit.Assert.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.BeforeClass;
import org.junit.Test;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import fr.kazepoy.fhir.mapper.util.FhirJson;

public class FhirMapperTransformerTest {
    private static final FhirMapperTester.Environment ENV = new FhirMapperTester.Environment() {
        public List<String> functions() { return List.of(); }
        public Map<String, String> configuration() { return Map.of(); }
        public String serialize(String type, String message) { return message; }
    };
    @BeforeClass public static void setup() { System.setProperty("fhir.engine.direct", "true"); }

    private static List<Map<String, Object>> laboratory() throws Exception {
        List<Map<String, Object>> steps = (List<Map<String, Object>>) FhirJson.parse(Files.readString(Path.of("doc/fr/demo/examples/mapping/laboratory.steps.json")));
        for (int i = 0; i < steps.size(); i++) {
            steps.get(i).put("sequenceNumber", String.valueOf(i + 3));
            steps.get(i).put("name", "step-" + i);
        }
        return steps;
    }
    private static Map<?, ?> run(List<?> steps) {
        return (Map<?, ?>) FhirJson.parse(FhirMapperTester.test(FhirJson.write(Map.of("steps", steps, "dataType", "JSON",
                "message", "{\"patient\":{\"id\":\"p1\"},\"observations\":[{\"code\":\"GLU\",\"value\":5.4}]}",
                "trace", Map.of("enabled", true, "captureValues", false))), ENV));
    }
    private static Map<?, ?> resource(Object encoded) { return (Map<?, ?>) FhirJson.parse(encoded.toString()); }

    @Test public void referencesResolveAndEveryStepReturnsItsProducedResources() throws Exception {
        Map<?, ?> result = run(laboratory());
        assertEquals(result.toString(), "[]", result.get("errors").toString());
        Map<?, ?> bundle = resource(result.get("output"));
        List<?> entries = (List<?>) bundle.get("entry");
        assertEquals(2, entries.size());
        String patientUrl = ((Map<?, ?>) entries.get(0)).get("fullUrl").toString();
        Map<?, ?> observation = (Map<?, ?>) ((Map<?, ?>) entries.get(1)).get("resource");
        assertEquals(patientUrl, ((Map<?, ?>) observation.get("subject")).get("reference"));
        List<?> produced = (List<?>) result.get("steps");
        assertEquals(3, produced.size());
        assertEquals("Observation", resource(((List<?>) ((Map<?, ?>) produced.get(2)).get("resources")).get(0)).get("resourceType"));
        Map<?, ?> trace = (Map<?, ?>) result.get("trace");
        assertEquals("transformer-preview", trace.get("scope"));
        assertTrue(((List<Map<?, ?>>) trace.get("events")).stream().anyMatch(e -> "5".equals(e.get("step")) && "value".equals(e.get("phase"))));
    }

    @Test public void twoNamedBundlesShareActualIdentitiesAndPublishVariables() throws Exception {
        List<Map<String, Object>> steps = laboratory();
        Map<String, Object> second = new LinkedHashMap<>(steps.get(0));
        second.put("bundleName", "archive"); second.put("variable", "archiveJson"); second.put("sequenceNumber", "4");
        steps.add(1, second);
        for (int i = 2; i < steps.size(); i++) steps.get(i).put("bundleTargets", "[{\"name\":\"laboratory\"},{\"name\":\"archive\"}]");
        Map<?, ?> result = run(steps);
        assertEquals(result.toString(), "[]", result.get("errors").toString());
        assertEquals(FhirJson.write(resource(result.get("output")).get("entry")), FhirJson.write(resource(((Map<?, ?>) result.get("variables")).get("archiveJson")).get("entry")));
    }

    @Test public void aRuleFailureKeepsTheCorrectStepAndPublishesNothing() throws Exception {
        List<Map<String, Object>> steps = laboratory();
        steps.get(2).put("mappings", steps.get(2).get("mappings").toString().replace("ob.value", "ob.missing.value"));
        Map<?, ?> result = run(steps);
        Map<?, ?> error = (Map<?, ?>) ((List<?>) result.get("errors")).get(0);
        assertEquals("5", ((Map<?, ?>) error.get("step")).get("sequenceNumber"));
        assertEquals("Observation.valueQuantity.value", error.get("key"));
        assertEquals(FhirJson.NULL, result.get("output"));
        assertTrue(((Map<?, ?>) result.get("variables")).isEmpty());
    }

    @Test public void unresolvedReferencesFailAtFinalizationInsteadOfReceivingStandIns() throws Exception {
        List<Map<String, Object>> steps = laboratory();
        steps.get(1).put("enabled", false);
        steps.get(2).put("mappings", steps.get(2).get("mappings").toString().replace("fhirRef('patient')", "fhirRef('patient', 0, true)"));
        Map<?, ?> result = run(steps);
        assertTrue(result.toString(), result.get("errors").toString().contains("unresolved reference"));
        assertTrue(result.toString(), result.get("errors").toString().contains("finalization"));
        assertEquals(FhirJson.NULL, result.get("output"));
    }

    @Test public void variableOnlyOutputDoesNotReturnTheInboundMessage() throws Exception {
        List<Map<String, Object>> steps = laboratory();
        steps.get(0).put("variable", "bundleJson");
        Map<?, ?> result = run(steps);
        assertEquals(result.toString(), "[]", result.get("errors").toString());
        assertEquals(FhirJson.NULL, result.get("output"));
        assertTrue(((Map<?, ?>) result.get("variables")).containsKey("bundleJson"));
    }

    @Test public void emptyAndUnsupportedStepListsAreExplicitErrors() {
        assertTrue(run(List.of()).get("errors").toString().contains("nonempty"));
        assertTrue(run(List.of(Map.of("__type", "JavaScript"))).get("errors").toString().contains("Only Mapper Transform"));
    }
    @Test public void finalValidationFailureDoesNotPublishEitherBundle() throws Exception {
        List<Map<String, Object>> steps = laboratory();
        Map<String, Object> archive = new LinkedHashMap<>(steps.get(0));
        archive.put("bundleName", "archive"); archive.put("variable", "archiveJson");
        steps.add(1, archive);
        for (int i = 2; i < steps.size(); i++) steps.get(i).put("bundleTargets", "[{\"name\":\"laboratory\"},{\"name\":\"archive\"}]");
        steps.get(3).put("mappings", steps.get(3).get("mappings").toString().replace("'final'", "'invalid-status'"));
        Map<?, ?> result = run(steps);
        assertTrue(result.toString(), result.get("errors").toString().contains("finalization"));
        assertEquals(FhirJson.NULL, result.get("output"));
        assertTrue(((Map<?, ?>) result.get("variables")).isEmpty());
    }

    @Test public void anOmittedResourceDoesNotClaimAnOutputOrValidation() {
        Map<?, ?> result = run(List.of(Map.of("action", "resource", "resourceType", "Patient", "validateOutput", true,
                "mappings", "[{\"key\":\"Patient\",\"path\":[],\"condition\":\"false\"}]")));
        assertEquals(result.toString(), "[]", result.get("errors").toString());
        assertEquals(FhirJson.NULL, result.get("output"));
        assertEquals(Boolean.FALSE, result.get("validationPerformed"));
    }

    private static List<Map<String, Object>> oru10Steps() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        var doc = factory.newDocumentBuilder().parse(Path.of("demo/oie-init/data/channels/10-oru-lab-transaction-mapper.xml").toFile());
        NodeList nodes = doc.getElementsByTagName("fr.kazepoy.fhir.mapper.FhirMapperTransformStep");
        String profiles = Path.of("demo/fhir-volume/shared/lab-r4").toAbsolutePath().toString();
        List<Map<String, Object>> steps = new ArrayList<>();
        for (int i = 0; i < nodes.getLength(); i++) {
            Element el = (Element) nodes.item(i);
            Map<String, Object> step = new LinkedHashMap<>();
            NodeList children = el.getChildNodes();
            for (int j = 0; j < children.getLength(); j++) {
                if (children.item(j) instanceof Element child) {
                    String tag = child.getTagName();
                    String val = child.getTextContent();
                    if ("addMetaProfile".equals(tag) || "setLastUpdated".equals(tag) || "enabled".equals(tag) || "traceMessages".equals(tag)) {
                        step.put(tag, Boolean.parseBoolean(val));
                    } else if ("terminologyCacheSeconds".equals(tag) || "terminologyTimeoutSeconds".equals(tag)) {
                        step.put(tag, Integer.parseInt(val));
                    } else {
                        step.put(tag, val);
                    }
                }
            }
            step.put("profiles", profiles);
            steps.add(step);
        }
        return steps;
    }

    private static String hl7Pid(String ipp, String family, String given, String dob, String sex) {
        return "<PID><PID.1><PID.1.1>1</PID.1.1></PID.1>"
                + "<PID.3><PID.3.1>" + ipp + "</PID.3.1><PID.3.4>EXAMPLE</PID.3.4><PID.3.5>PI</PID.3.5></PID.3>"
                + "<PID.5><PID.5.1>" + family + "</PID.5.1><PID.5.2>" + given + "</PID.5.2><PID.5.7>L</PID.5.7></PID.5>"
                + "<PID.7><PID.7.1>" + dob + "</PID.7.1></PID.7>"
                + "<PID.8><PID.8.1>" + sex + "</PID.8.1></PID.8></PID>";
    }

    private static String hl7Order(String ord, String fill, String code, String obxCode, String obxVal, String spm) {
        return "<ORC><ORC.1><ORC.1.1>SC</ORC.1.1></ORC.1><ORC.2><ORC.2.1>" + ord + "</ORC.2.1></ORC.2><ORC.5><ORC.5.1>CM</ORC.5.1></ORC.5><ORC.9><ORC.9.1>20260114080000</ORC.9.1></ORC.9></ORC>"
                + "<OBR><OBR.2><OBR.2.1>" + ord + "</OBR.2.1></OBR.2><OBR.3><OBR.3.1>" + fill + "</OBR.3.1></OBR.3><OBR.4><OBR.4.1>" + code + "</OBR.4.1><OBR.4.2>" + code + "</OBR.4.2></OBR.4><OBR.7><OBR.7.1>20260114073000</OBR.7.1></OBR.7><OBR.22><OBR.22.1>20260114170000</OBR.22.1></OBR.22><OBR.25><OBR.25.1>F</OBR.25.1></OBR.25></OBR>"
                + "<OBX><OBX.2><OBX.2.1>NM</OBX.2.1></OBX.2><OBX.3><OBX.3.1>" + obxCode + "</OBX.3.1><OBX.3.2>" + obxCode + "</OBX.3.2></OBX.3><OBX.5><OBX.5.1>" + obxVal + "</OBX.5.1></OBX.5><OBX.6><OBX.6.1>mmol/L</OBX.6.1></OBX.6><OBX.11><OBX.11.1>F</OBX.11.1></OBX.11><OBX.14><OBX.14.1>20260114073000</OBX.14.1></OBX.14></OBX>"
                + "<SPM><SPM.2><SPM.2.1><SPM.2.1.1>" + spm + "</SPM.2.1.1></SPM.2.1></SPM.2><SPM.4><SPM.4.1>SER</SPM.4.1><SPM.4.2>Sérum</SPM.4.2></SPM.4><SPM.17><SPM.17.1>20260114073000</SPM.17.1></SPM.17></SPM>";
    }

    @Test public void oru10AttachesEachPatientResultGroupToItsOwnPatientIpp() throws Exception {
        List<Map<String, Object>> steps = oru10Steps();
        String xml = "<HL7Message>"
                + "<MSH><MSH.7><MSH.7.1>20260114171908</MSH.7.1></MSH.7><MSH.10><MSH.10.1>MSG-2PAT</MSH.10.1></MSH.10></MSH>"
                + hl7Pid("100001", "MARTIN", "CLAIRE", "19800215", "F")
                + "<PV1><PV1.2><PV1.2.1>I</PV1.2.1></PV1.2><PV1.19><PV1.19.1>V-1</PV1.19.1></PV1.19></PV1>"
                + hl7Order("ORD-1", "LAB-1", "BIOCHEM", "GLU", "6.80", "SPM-1")
                + hl7Pid("200002", "DUPONT", "JEAN", "19750310", "M")
                + "<PV1><PV1.2><PV1.2.1>O</PV1.2.1></PV1.2><PV1.19><PV1.19.1>V-2</PV1.19.1></PV1.19></PV1>"
                + hl7Order("ORD-2", "LAB-2", "BIOCHEM", "K", "4.50", "SPM-2")
                + "</HL7Message>";

        Map<?, ?> result = (Map<?, ?>) FhirJson.parse(FhirMapperTester.test(
                FhirJson.write(Map.of("steps", steps, "dataType", "XML", "message", xml)), ENV));
        assertEquals(result.toString(), "[]", result.get("errors").toString());

        Map<?, ?> bundle = resource(result.get("output"));
        List<Map<?, ?>> entries = (List<Map<?, ?>>) bundle.get("entry");
        assertEquals(12, entries.size());

        Map<String, String> ippByFullUrl = new LinkedHashMap<>();
        Map<String, String> patientUrlByIpp = new LinkedHashMap<>();
        Map<String, String> encounterPatientByUrl = new LinkedHashMap<>();
        List<Map<?, ?>> patients = new ArrayList<>();
        for (Map<?, ?> entry : entries) {
            Map<?, ?> res = (Map<?, ?>) entry.get("resource");
            String fullUrl = entry.get("fullUrl").toString();
            String type = res.get("resourceType").toString();
            if ("Patient".equals(type)) {
                patients.add(entry);
                String ipp = ((Map<?, ?>) ((List<?>) res.get("identifier")).get(0)).get("value").toString();
                ippByFullUrl.put(fullUrl, ipp);
                patientUrlByIpp.put(ipp, fullUrl);
            } else if ("Encounter".equals(type)) {
                encounterPatientByUrl.put(fullUrl, ((Map<?, ?>) res.get("subject")).get("reference").toString());
            }
        }
        assertEquals(2, patients.size());
        assertEquals(List.of("MARTIN"), ((List<Map<?, ?>>) ((Map<?, ?>) patients.get(0).get("resource")).get("name")).stream().map(n -> n.get("family").toString()).toList());
        assertEquals(List.of("DUPONT"), ((List<Map<?, ?>>) ((Map<?, ?>) patients.get(1).get("resource")).get("name")).stream().map(n -> n.get("family").toString()).toList());
        assertEquals("PUT", ((Map<?, ?>) patients.get(0).get("request")).get("method"));
        assertEquals("Patient?identifier=http://example.org/fhir/oru2fhir/sid/ipp|100001", ((Map<?, ?>) patients.get(0).get("request")).get("url"));
        assertEquals("PUT", ((Map<?, ?>) patients.get(1).get("request")).get("method"));
        assertEquals("Patient?identifier=http://example.org/fhir/oru2fhir/sid/ipp|200002", ((Map<?, ?>) patients.get(1).get("request")).get("url"));

        Map<String, String> ippByObsCode = new LinkedHashMap<>();
        for (Map<?, ?> entry : entries) {
            Map<?, ?> res = (Map<?, ?>) entry.get("resource");
            String type = res.get("resourceType").toString();
            if ("Observation".equals(type)) {
                String code = ((Map<?, ?>) ((List<?>) ((Map<?, ?>) res.get("code")).get("coding")).get(0)).get("code").toString();
                String subjectRef = ((Map<?, ?>) res.get("subject")).get("reference").toString();
                String encounterRef = ((Map<?, ?>) res.get("encounter")).get("reference").toString();
                String ipp = ippByFullUrl.get(subjectRef);
                ippByObsCode.put(code, ipp);
                assertEquals(subjectRef, encounterPatientByUrl.get(encounterRef));
            } else if ("ServiceRequest".equals(type) || "Specimen".equals(type) || "DiagnosticReport".equals(type)) {
                String subjectRef = ((Map<?, ?>) res.get("subject")).get("reference").toString();
                assertTrue(ippByFullUrl.containsKey(subjectRef));
                if (res.containsKey("encounter")) {
                    assertEquals(subjectRef, encounterPatientByUrl.get(((Map<?, ?>) res.get("encounter")).get("reference").toString()));
                }
            }
        }
        assertEquals("100001", ippByObsCode.get("GLU"));
        assertEquals("200002", ippByObsCode.get("K"));
        assertEquals(patientUrlByIpp.get("100001"), encounterPatientByUrl.values().stream().filter(patientUrlByIpp.get("100001")::equals).findFirst().orElse(null));
        assertEquals(patientUrlByIpp.get("200002"), encounterPatientByUrl.values().stream().filter(patientUrlByIpp.get("200002")::equals).findFirst().orElse(null));

        // Asymmetric PV1: first patient has no PV1, second patient has PV1; Observation 1 must not borrow Encounter 2.
        String asymmetricXml = "<HL7Message>"
                + "<MSH><MSH.7><MSH.7.1>20260114171908</MSH.7.1></MSH.7><MSH.10><MSH.10.1>MSG-ASYM</MSH.10.1></MSH.10></MSH>"
                + hl7Pid("100001", "MARTIN", "CLAIRE", "19800215", "F")
                + hl7Order("ORD-1", "LAB-1", "BIOCHEM", "GLU", "6.80", "SPM-1")
                + hl7Pid("200002", "DUPONT", "JEAN", "19750310", "M")
                + "<PV1><PV1.2><PV1.2.1>O</PV1.2.1></PV1.2><PV1.19><PV1.19.1>V-2</PV1.19.1></PV1.19></PV1>"
                + hl7Order("ORD-2", "LAB-2", "BIOCHEM", "K", "4.50", "SPM-2")
                + "</HL7Message>";
        Map<?, ?> asymResult = (Map<?, ?>) FhirJson.parse(FhirMapperTester.test(
                FhirJson.write(Map.of("steps", steps, "dataType", "XML", "message", asymmetricXml)), ENV));
        assertEquals(asymResult.toString(), "[]", asymResult.get("errors").toString());
        List<Map<?, ?>> asymEntries = (List<Map<?, ?>>) resource(asymResult.get("output")).get("entry");
        for (Map<?, ?> entry : asymEntries) {
            Map<?, ?> res = (Map<?, ?>) entry.get("resource");
            if ("Observation".equals(res.get("resourceType"))) {
                String code = ((Map<?, ?>) ((List<?>) ((Map<?, ?>) res.get("code")).get("coding")).get(0)).get("code").toString();
                if ("GLU".equals(code)) assertFalse("First patient without PV1 must not get second patient's Encounter", res.containsKey("encounter"));
                if ("K".equals(code)) assertTrue("Second patient with PV1 must reference its Encounter", res.containsKey("encounter"));
            }
        }
    }

    @Test public void oru10PreservesCweValuesReconcilesCorrectionsAndRejectsUnsupportedObx2() throws Exception {
        List<Map<String, Object>> steps = oru10Steps();
        String cweMessage = "<HL7Message>"
                + "<MSH><MSH.7><MSH.7.1>20260114171908</MSH.7.1></MSH.7><MSH.10><MSH.10.1>MSG-CWE</MSH.10.1></MSH.10></MSH>"
                + hl7Pid("100001", "MARTIN", "CLAIRE", "19800215", "F")
                + "<ORC><ORC.1><ORC.1.1>SC</ORC.1.1></ORC.1><ORC.2><ORC.2.1>ORD-1</ORC.2.1></ORC.2><ORC.5><ORC.5.1>CM</ORC.5.1></ORC.5><ORC.9><ORC.9.1>20260114080000</ORC.9.1></ORC.9></ORC>"
                + "<OBR><OBR.2><OBR.2.1>ORD-1</OBR.2.1></OBR.2><OBR.3><OBR.3.1>LAB-1</OBR.3.1></OBR.3><OBR.4><OBR.4.1>BIOCHEM</OBR.4.1><OBR.4.2>Bilan</OBR.4.2></OBR.4><OBR.7><OBR.7.1>20260114073000</OBR.7.1></OBR.7><OBR.22><OBR.22.1>20260114170000</OBR.22.1></OBR.22><OBR.25><OBR.25.1>F</OBR.25.1></OBR.25></OBR>"
                + "<OBX><OBX.2><OBX.2.1>%s</OBX.2.1></OBX.2><OBX.3><OBX.3.1>GLU</OBX.3.1><OBX.3.2>Test codé</OBX.3.2></OBX.3><OBX.5><OBX.5.1>%s</OBX.5.1><OBX.5.2>%s</OBX.5.2><OBX.5.3>L</OBX.5.3></OBX.5><OBX.11><OBX.11.1>%s</OBX.11.1></OBX.11><OBX.14><OBX.14.1>20260114073000</OBX.14.1></OBX.14></OBX>"
                + "</HL7Message>";

        // 1. Final coded result (OBX-11=F, OBX-2=CWE, OBX-5=POS^Positif^L)
        Map<?, ?> finalResult = (Map<?, ?>) FhirJson.parse(FhirMapperTester.test(
                FhirJson.write(Map.of("steps", steps, "dataType", "XML", "message", String.format(cweMessage, "CWE", "POS", "Positif", "F"))), ENV));
        assertEquals(finalResult.toString(), "[]", finalResult.get("errors").toString());
        Map<?, ?> finalObsEntry = ((List<Map<?, ?>>) resource(finalResult.get("output")).get("entry")).stream()
                .filter(e -> "Observation".equals(((Map<?, ?>) e.get("resource")).get("resourceType"))).findFirst().orElseThrow();
        Map<?, ?> finalObs = (Map<?, ?>) finalObsEntry.get("resource");
        assertEquals("final", finalObs.get("status"));
        Map<?, ?> finalVal = (Map<?, ?>) finalObs.get("valueCodeableConcept");
        assertEquals("Positif", finalVal.get("text"));
        Map<?, ?> finalCoding = (Map<?, ?>) ((List<?>) finalVal.get("coding")).get(0);
        assertEquals("POS", finalCoding.get("code"));
        assertEquals("Positif", finalCoding.get("display"));
        assertEquals("http://example.org/fhir/oru2fhir/CodeSystem/lab-codes", finalCoding.get("system"));
        String expectedId = "LAB-1|GLU";
        Map<?, ?> finalId = (Map<?, ?>) ((List<?>) finalObs.get("identifier")).get(0);
        assertEquals("http://example.org/fhir/oru2fhir/sid/observation", finalId.get("system"));
        assertEquals(expectedId, finalId.get("value"));
        String expectedPutUrl = "Observation?identifier=http://example.org/fhir/oru2fhir/sid/observation|" + expectedId;
        assertEquals("PUT", ((Map<?, ?>) finalObsEntry.get("request")).get("method"));
        assertEquals(expectedPutUrl, ((Map<?, ?>) finalObsEntry.get("request")).get("url"));

        // 2. Correction (OBX-11=C, OBX-5=NEG^Négatif^L) & 3. Replay of correction
        String correctedXml = String.format(cweMessage, "CWE", "NEG", "Négatif", "C");
        for (int attempt = 0; attempt < 2; attempt++) {
            Map<?, ?> corrResult = (Map<?, ?>) FhirJson.parse(FhirMapperTester.test(
                    FhirJson.write(Map.of("steps", steps, "dataType", "XML", "message", correctedXml)), ENV));
            assertEquals(corrResult.toString(), "[]", corrResult.get("errors").toString());
            Map<?, ?> corrObsEntry = ((List<Map<?, ?>>) resource(corrResult.get("output")).get("entry")).stream()
                    .filter(e -> "Observation".equals(((Map<?, ?>) e.get("resource")).get("resourceType"))).findFirst().orElseThrow();
            Map<?, ?> corrObs = (Map<?, ?>) corrObsEntry.get("resource");
            assertEquals("corrected", corrObs.get("status"));
            Map<?, ?> corrCoding = (Map<?, ?>) ((List<?>) ((Map<?, ?>) corrObs.get("valueCodeableConcept")).get("coding")).get(0);
            assertEquals("NEG", corrCoding.get("code"));
            assertEquals("Négatif", corrCoding.get("display"));
            assertEquals(expectedId, ((Map<?, ?>) ((List<?>) corrObs.get("identifier")).get(0)).get("value"));
            assertEquals("PUT", ((Map<?, ?>) corrObsEntry.get("request")).get("method"));
            assertEquals(expectedPutUrl, ((Map<?, ?>) corrObsEntry.get("request")).get("url"));
        }

        // 4. Out-of-contract OBX-2 (e.g. DT) must be explicitly rejected
        Map<?, ?> invalidResult = (Map<?, ?>) FhirJson.parse(FhirMapperTester.test(
                FhirJson.write(Map.of("steps", steps, "dataType", "XML", "message", String.format(cweMessage, "DT", "20260114", "", "F"))), ENV));
        assertFalse(invalidResult.get("errors").toString(), ((List<?>) invalidResult.get("errors")).isEmpty());
        assertTrue(invalidResult.get("errors").toString(), invalidResult.get("errors").toString().contains("hors contrat"));
        assertEquals(FhirJson.NULL, invalidResult.get("output"));
    }

    @Test public void bundleEntryIsValidatedAgainstItsStepProfileEvenWithoutMetaProfile() {
        String profiles = Path.of("src/test/resources/profiles/patient-with-birthdate.json").toAbsolutePath().toString();
        Map<String, Object> bundleStep = Map.ofEntries(
                Map.entry("action", "createBundle"), Map.entry("name", "Bundle"), Map.entry("sequenceNumber", "1"), Map.entry("enabled", true),
                Map.entry("fhirVersion", "R4"), Map.entry("profiles", profiles), Map.entry("profileUrl", "Bundle"), Map.entry("resourceType", "Bundle"),
                Map.entry("bundleName", "labo"), Map.entry("bundleType", "transaction"), Map.entry("validateOutput", true),
                Map.entry("mappings", "[{\"key\":\"Bundle.type\",\"fixed\":\"transaction\",\"when\":0,\"path\":[[\"type\"]]}]"));
        Map<String, Object> patientStep = Map.ofEntries(
                Map.entry("action", "resource"), Map.entry("name", "Patient"), Map.entry("sequenceNumber", "2"), Map.entry("enabled", true),
                Map.entry("fhirVersion", "R4"), Map.entry("profiles", profiles),
                Map.entry("profileUrl", "http://example.org/fhir/StructureDefinition/patient-with-birthdate"),
                Map.entry("resourceType", "Patient"), Map.entry("addMetaProfile", false), Map.entry("validateOutput", true),
                Map.entry("bundleTargets", "[{\"name\":\"labo\",\"requestMethod\":\"POST\"}]"),
                Map.entry("mappings", "[{\"key\":\"Patient.id\",\"element\":\"Patient.id\",\"type\":\"id\",\"expression\":\"'p1'\",\"path\":[[\"id\"]]}]"));

        Map<?, ?> result = run(List.of(bundleStep, patientStep));
        assertFalse(result.get("errors").toString(), ((List<?>) result.get("errors")).isEmpty());
        assertTrue(result.get("errors").toString(), result.get("errors").toString().contains("birthDate"));
        assertEquals(FhirJson.NULL, result.get("output"));
    }

    private static Map<?, ?> runObsDateTime(String context, String xml) {
        String dtMapping = "[{\"key\":\"Observation.effectiveDateTime\",\"element\":\"Observation.effectiveDateTime\",\"type\":\"dateTime\",\"expression\":\"msg['OBX']['OBX.14']['OBX.14.1'].toString()\",\"path\":[[\"effectiveDateTime\"]]}]";
        Map<String, Object> step = Map.of("action", "resource", "name", "Observation", "resourceType", "Observation",
                "profileUrl", "Observation", "addMetaProfile", false, "context", context, "mappings", dtMapping);
        return (Map<?, ?>) FhirJson.parse(FhirMapperTester.test(FhirJson.write(Map.of("step", step, "dataType", "XML", "message", xml)), ENV));
    }

    @Test public void dateTimePolicyRejectsIncompleteHoursAndDstAmbiguityUnlessConfigured() {
        fr.kazepoy.fhir.mapper.FhirMapperSettings.load("{\"contexts\":[{\"name\":\"paris-strict\",\"timeZone\":\"Europe/Paris\",\"validation\":\"off\"},"
                + "{\"name\":\"paris-earlier\",\"timeZone\":\"Europe/Paris\",\"ambiguousTime\":\"earlier\",\"validation\":\"off\"},"
                + "{\"name\":\"paris-later\",\"timeZone\":\"Europe/Paris\",\"ambiguousTime\":\"later\",\"validation\":\"off\"}]}");
        try {
            Map<?, ?> incomplete = runObsDateTime("paris-strict", "<HL7Message><OBX><OBX.14><OBX.14.1>2026102502</OBX.14.1></OBX.14></OBX></HL7Message>");
            assertTrue(incomplete.toString(), incomplete.get("errors").toString().contains("timePrecision=minutes"));

            Map<?, ?> ambiguous = runObsDateTime("paris-strict", "<HL7Message><OBX><OBX.14><OBX.14.1>202610250200</OBX.14.1></OBX.14></OBX></HL7Message>");
            assertTrue(ambiguous.toString(), ambiguous.get("errors").toString().contains("ambiguous"));

            Map<?, ?> gap = runObsDateTime("paris-strict", "<HL7Message><OBX><OBX.14><OBX.14.1>202603290230</OBX.14.1></OBX.14></OBX></HL7Message>");
            assertTrue(gap.toString(), gap.get("errors").toString().contains("does not exist"));

            Map<?, ?> msh7 = runObsDateTime("paris-strict", "<HL7Message><MSH><MSH.7><MSH.7.1>202610250100+0200</MSH.7.1></MSH.7></MSH><OBX><OBX.14><OBX.14.1>202610250200</OBX.14.1></OBX.14></OBX></HL7Message>");
            assertEquals("[]", msh7.get("errors").toString());
            assertEquals("2026-10-25T02:00:00+02:00", resource(msh7.get("output")).get("effectiveDateTime"));

            Map<?, ?> earlier = runObsDateTime("paris-earlier", "<HL7Message><OBX><OBX.14><OBX.14.1>202610250200</OBX.14.1></OBX.14></OBX></HL7Message>");
            assertEquals("[]", earlier.get("errors").toString());
            assertEquals("2026-10-25T02:00:00+02:00", resource(earlier.get("output")).get("effectiveDateTime"));

            Map<?, ?> later = runObsDateTime("paris-later", "<HL7Message><OBX><OBX.14><OBX.14.1>202610250200</OBX.14.1></OBX.14></OBX></HL7Message>");
            assertEquals("[]", later.get("errors").toString());
            assertEquals("2026-10-25T02:00:00+01:00", resource(later.get("output")).get("effectiveDateTime"));
        } finally {
            fr.kazepoy.fhir.mapper.FhirMapperSettings.load(null);
        }
    }

}
