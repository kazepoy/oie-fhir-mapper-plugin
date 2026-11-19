// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { signIn, openStep } from "./session.js";
import { readRepoFile, assertCleanTestResult, assertNormalizedEqual } from "./oie-client.js";

const open = page => openStep(page, "02 ADT A28 to Patient - Terminology", "Nested imports and multiple models", "Settings context to Patient");

test("Properties and Test scroll inside their panels while the main and test tabs stay visible", async () => {
  const session = await signIn();
  try {
    await session.page.setViewportSize({ width: 1280, height: 520 });
    await open(session.page);
    const editor = session.page.locator(".fhir-fml");
    await editor.getByRole("button", { name: /Full screen/ }).click();
    await editor.getByText("Context details (managed in Settings)", { exact: true }).click();
    const tabs = editor.locator(":scope > .fml-tabs");
    const before = await tabs.boundingBox();
    const pane = editor.locator(":scope > [role=tabpanel]");
    assert.equal(await pane.evaluate(el => getComputedStyle(el).overflowY), "auto");
    const scrolled = await pane.evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
    assert.ok(scrolled > 0, "The Properties panel must scroll at this viewport height");
    assert.equal((await tabs.boundingBox()).y, before.y);
    await editor.getByRole("tab", { name: "Map", exact: true }).click();
    await editor.locator(".fml-map-editor .monaco-editor").waitFor();
    await pane.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal((await tabs.boundingBox()).y, before.y);
    await editor.getByRole("tab", { name: "Test", exact: true }).click();
    const testTabs = editor.locator(".fml-test-actions");
    const testBefore = await testTabs.boundingBox();
    await session.page.waitForFunction(() => window.monaco.editor.getEditors().some(e => e.getDomNode()?.closest("#fml-test-panel-sample")));
    const codeScroll = await session.page.evaluate(() => {
      const code = window.monaco.editor.getEditors().find(e => e.getDomNode()?.closest("#fml-test-panel-sample"));
      code.setScrollTop(1000);
      return code.getScrollTop();
    });
    assert.ok(codeScroll > 0, "The sample must scroll inside its editor");
    assert.equal((await tabs.boundingBox()).y, before.y);
    assert.equal((await testTabs.boundingBox()).y, testBefore.y);
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});

test("Copy to inline map loads the selected FML with its imports, then runs the editable copy", async () => {
  const session = await signIn();
  try {
    await open(session.page);
    const editor = session.page.locator(".fhir-fml");
    const original = await readRepoFile("demo/fhir-volume/02-adt-patient-context/PatientToBundle.fml");
    assert.equal(await editor.getByRole("button", { name: "Write an inline map", exact: true }).count(), 0);
    const copied = session.page.waitForResponse(r => r.url().includes("/fhir-fml/map?"));
    await editor.getByRole("button", { name: "Copy to inline map", exact: true }).click();
    const response = await copied;
    assert.equal(response.status(), 200);
    assert.equal(await response.text(), original);
    await session.page.waitForFunction(text => window.monaco.editor.getEditors()
      .some(e => e.getDomNode()?.closest(".fml-map-editor") && e.getValue() === text), original);
    assert.equal(await editor.getByRole("tab", { name: "Map", exact: true }).getAttribute("aria-selected"), "true");
    await editor.getByRole("tab", { name: "Test", exact: true }).click();
    const reply = session.page.waitForResponse(r => r.url().endsWith("/fhir-fml/test"));
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    const result = await (await reply).json();
    assertCleanTestResult(result, "Copied inline FML");
    assertNormalizedEqual(result.output, await readRepoFile("demo/oie-init/data/samples/adt-a28/imported-bundle.json"));
    assert.equal(await readRepoFile("demo/fhir-volume/02-adt-patient-context/PatientToBundle.fml"), original);
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});
