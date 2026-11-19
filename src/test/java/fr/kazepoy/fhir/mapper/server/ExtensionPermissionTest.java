/* SPDX-License-Identifier: MPL-2.0 */
package fr.kazepoy.fhir.mapper.server;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

import org.junit.Test;
import fr.kazepoy.fhir.mapper.FhirMapperServletInterface;

import com.mirth.connect.client.core.api.MirthOperation;
import com.mirth.connect.model.ExtensionPermission;

/** An authorization plugin enforces only declared extension permissions: every route needs one. */
public class ExtensionPermissionTest {
    @Test public void everyRouteBelongsToExactlyOneExtensionPermission() {
        FhirMapperPlugin plugin = new FhirMapperPlugin();
        Map<String, String> owner = new HashMap<>();
        for (ExtensionPermission permission : plugin.getExtensionPermissions()) {
            assertEquals(plugin.getPluginPointName(), permission.getExtensionName());
            for (String operation : permission.getOperationNames()) {
                assertEquals("declared twice: " + operation, null, owner.put(operation, permission.getDisplayName()));
            }
        }
        int routes = 0;
        for (Method method : FhirMapperServletInterface.class.getDeclaredMethods()) {
            MirthOperation operation = method.getAnnotation(MirthOperation.class);
            if (operation == null) continue;
            routes++;
            assertTrue("no extension permission for " + operation.name(), owner.containsKey(operation.name()));
        }
        assertEquals(routes, owner.size());
        assertEquals(FhirMapperServletInterface.PERMISSION_TEST, owner.get("testFhirMapper"));
        for (Method method : FhirMapperServletInterface.class.getDeclaredMethods()) {
            MirthOperation operation = method.getAnnotation(MirthOperation.class);
            if (operation != null) assertEquals(operation.name(), owner.get(operation.name()), operation.permission());
        }
        assertTrue(Arrays.stream(plugin.getExtensionPermissions()).allMatch(p -> p.getTaskNames().length == 0));
    }
}
