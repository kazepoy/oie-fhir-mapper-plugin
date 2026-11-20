// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { signIn, openStep } from "./session.js";
import { assertCleanTestResult, assertNormalizedEqual, readRepoFile } from "./oie-client.js";

test("Properties and Test resolve separate map and model variables without saving the channel", async () => {
  const session = await signIn();
  const page = session.page;
  try {
    await openStep(page, "06 JSON Order to Dispatch", "Order to dispatch document");
    const editor = page.locator(".fhir-fml");
    await editor.getByRole("combobox", { name: "Source model", exact: true }).selectOption("logical");
    await editor.getByRole("combobox", { name: "Logical model (StructureDefinition)", exact: true }).fill("${fmlSourceModelUrl}");
    await editor.getByRole("combobox", { name: "Map from the context", exact: true }).fill("${fmlMapUrl}");
    await editor.getByRole("tab", { name: "Test", exact: true }).click();
    await editor.getByRole("textbox", { name: "fmlMapUrl", exact: true }).fill("http://example.org/fml-demo/StructureMap/CommandeToBon");
    await editor.getByRole("textbox", { name: "fmlSourceModelUrl", exact: true }).fill("http://example.org/fml-demo/StructureDefinition/CommandeSource");
    const reply = page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    const result = await (await reply).json();
    assertCleanTestResult(result, "Dynamic references");
    assertNormalizedEqual(result.output, await readRepoFile("demo/oie-init/data/samples/06-json-order-to-dispatch/expected.json"));
    assert.deepEqual(result.resolvedReferences, {
      mapUrl: "http://example.org/fml-demo/StructureMap/CommandeToBon",
      sourceModelUrl: "http://example.org/fml-demo/StructureDefinition/CommandeSource"
    });
    await editor.getByText("Resolved references", { exact: true }).click();
    await editor.locator(".fml-resolved-references code").first().waitFor();
    assert.equal(await editor.locator(".fml-resolved-references code").count(), 2);
    await editor.getByRole("tab", { name: "Sample", exact: true }).click();
    await editor.getByRole("textbox", { name: "fmlSourceModelUrl", exact: true }).fill("");
    const missing = page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    const rejected = await (await missing).json();
    assert.equal(rejected.errors[0].phase, "configuration");
    assert.match(rejected.errors[0].message, /fmlSourceModelUrl.*missing or empty/);
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});
