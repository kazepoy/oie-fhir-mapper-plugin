// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { signIn, openStep } from "./session.js";

const shared = { name: "test-shared", fhirVersion: "R4B", packages: ["/shared/demo.tgz"], validation: "off",
  terminologyServer: "", terminologyAuthorization: "", cacheSeconds: 300, timeoutSeconds: 10 };

async function sessionWithContext() {
  const session = await signIn();
  await session.page.route("**/extensions/fhir-mapper/settings", route => route.fulfill({ json: { contexts: [shared] } }));
  await session.page.route("**/extensions/fhir-fml/maps**", route => route.fulfill({ json: { maps: [], errors: {} } }));
  return session;
}

test("Properties orders the flow and switches between shared and local contexts without losing local values", async () => {
  const session = await sessionWithContext();
  try {
    await openStep(session.page, "01 ADT A28 to Patient - Inline FML", "PID XML to Patient", "XML to Patient");
    const editor = session.page.locator(".fhir-fml");
    await editor.getByRole("button", { name: /Full screen/ }).click();
    assert.deepEqual(await editor.getByRole("combobox", { name: "Source model", exact: true }).locator("option").evaluateAll(options => options.map(o => o.value)),
      ["fhir", "logical", "oie-message"]);
    const context = editor.getByRole("combobox", { name: "FHIR context", exact: true });
    await context.locator('option[value="test-shared"]').waitFor({ state: "attached" });
    assert.deepEqual(await editor.locator(".fml-property-section").evaluateAll(nodes => nodes.map(n => n.dataset.section)), ["Source", "Map", "Destination"]);
    assert.equal(await editor.getByRole("combobox", { name: "FHIR version", exact: true }).isEnabled(), true);
    await editor.getByRole("combobox", { name: "FHIR version", exact: true }).selectOption("R5");
    await editor.getByRole("textbox", { name: "Packages", exact: true }).fill("/local/one\n/local/two");
    await editor.getByRole("combobox", { name: "Validation of results", exact: true }).selectOption("off");
    assert.equal(await editor.getByRole("checkbox").count(), 2);
    await editor.getByText("Terminology server options", { exact: true }).click();
    const terminology = editor.getByRole("textbox", { name: "Terminology server", exact: true });
    assert.equal(await terminology.isEnabled(), true);
    await terminology.fill("http://local-tx/fhir");
    await context.selectOption("test-shared");
    assert.equal(await editor.locator(".fml-context-summary").textContent(), "R4B · 1 location(s) · validation: off");
    await editor.getByText("Context details (managed in Settings)", { exact: true }).click();
    assert.equal(await editor.getByRole("combobox", { name: "FHIR version", exact: true }).isDisabled(), true);
    assert.equal(await editor.getByRole("textbox", { name: "Packages", exact: true }).inputValue(), "/shared/demo.tgz");
    const validation = editor.getByRole("checkbox", { name: "Validate the result", exact: true });
    assert.equal(await validation.isChecked(), false);
    await validation.check();
    assert.equal(await context.inputValue(), "test-shared");
    assert.equal(await validation.isChecked(), true);
    await editor.getByRole("button", { name: "Use context policy", exact: true }).click();
    assert.equal(await validation.isChecked(), false);
    await context.selectOption("");
    assert.equal(await editor.getByRole("combobox", { name: "FHIR version", exact: true }).inputValue(), "R5");
    await editor.getByText("Terminology server options", { exact: true }).click();
    assert.equal(await terminology.inputValue(), "http://local-tx/fhir");
    assert.equal(await editor.getByRole("textbox", { name: "Packages", exact: true }).inputValue(), "/local/one\n/local/two");
    assert.equal(await editor.getByRole("combobox", { name: "Validation of results", exact: true }).inputValue(), "off");
    assert.equal(await editor.getByRole("combobox", { name: "Map from the context", exact: true }).count(), 0, "Inline maps have no inactive resource selector");
    await editor.getByRole("button", { name: "Edit map", exact: true }).click();
    assert.equal(await editor.getByRole("tab", { name: "Map", exact: true }).getAttribute("aria-selected"), "true");
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});

test("Settings uses the same context form as the step", async () => {
  const session = await sessionWithContext();
  try {
    await session.page.locator("[data-nav-item]").filter({ hasText: /^Settings$/ }).click();
    await session.page.getByRole("tab", { name: "FHIR Mapper", exact: true }).click();
    const form = session.page.locator('.fhir-mapper-settings [data-context="test-shared"] .fhir-context-fields');
    await form.waitFor();
    assert.equal(await form.getByRole("combobox", { name: "FHIR version", exact: true }).inputValue(), "R4B");
    assert.equal(await form.getByRole("combobox", { name: "Validation of results", exact: true }).inputValue(), "off");
    assert.equal(await form.getByRole("textbox", { name: "Packages", exact: true }).inputValue(), "/shared/demo.tgz");
    await form.getByText("Terminology server options", { exact: true }).click();
    assert.equal(await form.getByRole("textbox", { name: "Terminology server", exact: true }).isEnabled(), true);
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});

test("configured terminology options open automatically in local contexts, shared contexts and Settings", async () => {
  const session = await signIn();
  try {
    await openStep(session.page, "02 ADT A28 to Patient - Terminology", "Patient with gender translation", "XML to Patient");
    const editor = session.page.locator(".fhir-fml");
    const terminology = editor.getByRole("textbox", { name: "Terminology server", exact: true });
    await terminology.waitFor({ state: "visible" });
    assert.equal(await terminology.inputValue(), "http://term-server:8500/fhir");
    assert.notEqual(await editor.locator(".fhir-context-terminology").getAttribute("open"), null);
    await editor.getByRole("button", { name: /Full screen/ }).click();
    await openStep(session.page, "02 ADT A28 to Patient - Terminology", "Patient with profile and context", "Settings context to Patient");
    await session.page.locator(".fhir-fml").getByText("Context details (managed in Settings)", { exact: true }).click();
    const shared = session.page.locator(".fhir-fml").getByRole("textbox", { name: "Terminology server", exact: true });
    await shared.waitFor({ state: "visible" });
    assert.equal(await shared.isDisabled(), true);
    await session.page.locator("[data-nav-item]").filter({ hasText: /^Settings$/ }).click();
    await session.page.getByRole("tab", { name: "FHIR Mapper", exact: true }).click();
    const form = session.page.locator('.fhir-mapper-settings [data-context="patient-r4"] .fhir-context-fields');
    await form.getByRole("textbox", { name: "Terminology server", exact: true }).waitFor({ state: "visible" });
    assert.notEqual(await form.locator(".fhir-context-terminology").getAttribute("open"), null);
    assert.deepEqual(session.pluginErrors(), []);
  } finally { await session.close(); }
});
