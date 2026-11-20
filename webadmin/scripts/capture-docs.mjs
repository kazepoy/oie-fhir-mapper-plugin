// SPDX-License-Identifier: MPL-2.0
// Run with npm run capture:docs. The demo must already be initialized.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signIn, openStep, DEMO_URL } from "../test/e2e/session.js";
import { assertCleanTestResult } from "../test/e2e/oie-client.js";
import { preparePluginCapture } from "../test/e2e/capture-frame.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const images = resolve(root, "doc/fr/user-manual");
const only = process.argv.find(arg => arg.startsWith("--only="))?.slice(7);
const session = await signIn({ colorScheme: "dark", locale: "en-US" });
const page = session.page;
await page.setViewportSize({ width: 1600, height: 1000 });
const screenshot = async (path, { keepFocus = false } = {}) => {
  const destination = resolve(images, path);
  await mkdir(dirname(destination), { recursive: true });
  if (!keepFocus) await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: destination, animations: "disabled" });
  console.log(path);
};
const openMapper = async (step = "Patient") => {
  await openStep(page, "10 ORU to Lab Bundle - Mapper", step);
  await page.locator(".fhir-mapper-transform").getByRole("tab", { name: "Mapper", exact: true }).click();
  await page.locator(".fhir-mapper-transform table.mapper-tree tbody tr").first().waitFor();
  await preparePluginCapture(page, { mapper: true });
  return page.locator(".fhir-mapper-transform");
};
const openFml = async () => {
  await openStep(page, "01 ADT A28 to Patient - Inline FML", "PID XML to Patient", "XML to Patient");
  await preparePluginCapture(page);
  return page.locator(".fhir-fml");
};
const runPreview = async (plugin, endpoint, button) => {
  const response = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === "POST");
  await plugin.getByRole("button", { name: button, exact: true }).click();
  const result = await (await response).json();
  assertCleanTestResult(result, "Documentation screenshot preview");
};
try {
  await page.evaluate(async () => {
    const { setTheme } = await import(new URL("core/store.js", document.baseURI).href);
    setTheme("dark");
  });
  if (!only || only === "fml") {
    const fml = await openFml();
    await screenshot("fml/images/proprietes.png");
    await fml.getByRole("tab", { name: "Map", exact: true }).click();
    const checked = page.waitForResponse(r => r.url().endsWith("/fhir-fml/check"));
    await fml.getByRole("button", { name: "Check", exact: true }).click();
    const check = await (await checked).json();
    assert.deepEqual(check.errors, [], JSON.stringify(check));
    await fml.locator(".fml-ok").waitFor();
    await preparePluginCapture(page);
    await screenshot("fml/images/map-editeur.png");
    await screenshot("images/fhir-fml.png");
    await fml.getByRole("tab", { name: "Test", exact: true }).click();
    await runPreview(fml, "/fhir-fml/test", "Run test");
    await fml.getByRole("tab", { name: "Result", exact: true }).click();
    await preparePluginCapture(page);
    await screenshot("fml/images/test-resultat.png");
    await fml.getByRole("tab", { name: "FML source", exact: true }).click();
    await preparePluginCapture(page);
    await screenshot("fml/images/test-fml-source.png");
  }
  if (!only || only === "mapper") {
    const mapper = await openMapper();
    await screenshot("images/fhir-mapper.png");
    await screenshot("mapper-transform/images/mapper-arbre.png");
    await mapper.getByRole("tab", { name: "Properties", exact: true }).click();
    await screenshot("mapper-transform/images/proprietes.png");
    await mapper.getByRole("tab", { name: "Import / Export", exact: true }).click();
    await screenshot("mapper-transform/images/import-export.png");
    await mapper.getByRole("tab", { name: "Mapper", exact: true }).click();
    await mapper.getByRole("button", { name: "FHIR help for Patient.gender", exact: true }).click();
    await mapper.getByRole("dialog").waitFor();
    await screenshot("mapper-transform/images/inspecteur-modal.png");
    await page.keyboard.press("Escape");
    const expression = mapper.locator("tr[title^='Patient.gender'] [role=combobox]").first();
    await expression.click();
    await page.waitForFunction(() => window.monaco.editor.getEditors()
      .some(editor => editor.getDomNode()?.closest("tr")?.title.startsWith("Patient.gender")
        && editor.getOption(window.monaco.editor.EditorOption.suggest).showInlineDetails));
    const suggestions = page.locator(".suggest-widget.visible");
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.evaluate(async () => {
        const editor = window.monaco.editor.getEditors()
          .find(editor => editor.getDomNode()?.closest("tr")?.title.startsWith("Patient.gender"));
        editor.focus();
        editor.setPosition({ lineNumber: 1, column: 1 });
        await editor.getAction("editor.action.triggerSuggest").run();
      });
      try { await suggestions.waitFor({ timeout: 1500 }); break; }
      catch (error) { if (attempt === 2) throw error; }
    }
    await screenshot("mapper-transform/images/completion.png", { keepFocus: true });
    await page.keyboard.press("Escape");
    await mapper.getByRole("tab", { name: "Test", exact: true }).click();
    await mapper.getByRole("checkbox", { name: "Trace", exact: true }).check();
    await screenshot("mapper-transform/images/test-samples.png");
    await runPreview(mapper, "/fhir-mapper/test", "Run test");
    await mapper.getByRole("tab", { name: "Result", exact: true }).click();
    await preparePluginCapture(page);
    await screenshot("mapper-transform/images/test-resultat.png");
    await mapper.getByRole("tab", { name: /Trace/ }).click();
    await screenshot("mapper-transform/images/test-trace.png");
    await openStep(page, "10 ORU to Lab Bundle - Mapper", "Bundle");
    const bundle = page.locator(".fhir-mapper-transform");
    await bundle.getByRole("tab", { name: "Properties", exact: true }).click();
    await preparePluginCapture(page);
    await screenshot("mapper-transform/images/bundles-et-sortie.png");
    await openMapper("Observation");
    await screenshot("mapper-transform/images/regles-et-traductions.png");
  }
  if (!only || only === "settings") {
    await page.goto(DEMO_URL);
    await page.locator("[data-nav-item]").filter({ hasText: /^Settings$/ }).first().click();
    await page.getByText("FHIR Mapper", { exact: true }).click();
    const settings = page.locator(".fhir-mapper-settings");
    await settings.getByLabel("Context name", { exact: true }).first().waitFor();
    await screenshot("settings/images/contextes.png");
    await settings.getByRole("button", { name: "New context", exact: true }).click();
    await screenshot("settings/images/nouveau-contexte.png");
    await settings.locator("select").filter({ has: page.locator('option[value="fr"]') }).selectOption("fr");
    await screenshot("settings/images/langue-fr.png");
  }
  assert.deepEqual(session.pluginErrors(), []);
} finally { await session.close(); }
