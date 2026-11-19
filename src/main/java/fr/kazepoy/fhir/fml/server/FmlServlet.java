/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.fml.server;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import javax.servlet.http.HttpServletRequest;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.SecurityContext;

import com.mirth.connect.client.core.ClientException;
import com.mirth.connect.server.api.MirthServlet;
import com.mirth.connect.server.userutil.SerializerFactory;
import fr.kazepoy.fhir.fml.FmlFacade;
import fr.kazepoy.fhir.fml.FmlServletInterface;
import fr.kazepoy.fhir.mapper.util.FhirJson;

/** The lookups and test of the FHIR FML Transform editor. */
public class FmlServlet extends MirthServlet implements FmlServletInterface {

    public FmlServlet(@Context HttpServletRequest request, @Context SecurityContext sc) {
        super(request, sc, PLUGIN_NAME);
    }

    @Override
    public String getMaps(String fhirVersion, String profiles) throws ClientException {
        try {
            return FmlFacade.listMaps(fhirVersion, profiles);
        } catch (Exception e) {
            throw new ClientException(e.getMessage(), e);
        }
    }

    @Override
    public String getMap(String url, String fhirVersion, String profiles) throws ClientException {
        try {
            return FmlFacade.mapSource(url, fhirVersion, profiles);
        } catch (Exception e) {
            throw new ClientException(e.getMessage(), e);
        }
    }

    @Override
    public String getSource(String request) throws ClientException {
        try {
            return FmlTester.source(request, SERIALIZER);
        } catch (Exception e) {
            throw new ClientException(e.getMessage(), e);
        }
    }

    @Override
    public String check(String request) throws ClientException {
        try {
            return FmlTester.check(request);
        } catch (Exception e) {
            throw new ClientException(e.getMessage(), e);
        }
    }

    @Override
    public String reload() throws ClientException {
        try {
            FmlFacade.clearCaches();
            return "{\"reloaded\":true}";
        } catch (Exception e) {
            throw new ClientException(e.getMessage(), e);
        }
    }

    @Override
    public String test(String request) throws ClientException {
        Map<String, String> configuration = new LinkedHashMap<>();
        try {
            com.mirth.connect.server.controllers.ControllerFactory.getFactory().createConfigurationController()
                    .getConfigurationProperties().forEach((key, value) -> configuration.put(key, value.getValue()));
        } catch (Exception ignored) { /* The preview can run without configuration variables. */ }
        return FmlTester.test(request, SERIALIZER, configuration);
    }

    /** A sample message as a transformer sees it: OIE's internal XML, or JSON and raw text as they are. */
    private static final FmlTester.Serializer SERIALIZER = (dataType, message, properties) -> {
        Map<String, Object> serialization = new LinkedHashMap<>(FmlTester.properties(properties.get("serializationProperties")));
        if ("DELIMITED".equals(dataType)) {
            // Channel exports hold arrays; SerializerFactory expects comma-separated properties.
            for (String key : List.of("columnNames", "columnWidths")) {
                Object value = serialization.get(key);
                if (value instanceof Map<?, ?> entries) value = entries.get("columnNames".equals(key) ? "string" : "int");
                if (value instanceof List<?> items) value = items.stream().map(Object::toString).collect(Collectors.joining(","));
                if (value != null && value != FhirJson.NULL) serialization.put(key, value.toString());
                else serialization.remove(key);
            }
        }
        Map<String, Object> deserialization = FmlTester.properties(properties.get("deserializationProperties"));
        return SerializerFactory.getSerializer(dataType, serialization, deserialization).toXML(message);
    };
}
