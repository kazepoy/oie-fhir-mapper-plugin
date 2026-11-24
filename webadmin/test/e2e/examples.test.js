// SPDX-License-Identifier: MPL-2.0
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openStep, signIn } from "./session.js";

const waitForCodeLayout = page => page.waitForFunction(() => {
  const editors = window.monaco.editor.getEditors()
    .map(editor => [editor, editor.getDomNode()?.closest(".mapper-test-panel:not([hidden]) .fm-code-box")])
    .filter(([, host]) => host);
  return editors.length > 0 && editors.every(([editor, host]) =>
    Math.abs(editor.getLayoutInfo().height - host.clientHeight) < 6);
});

describe("the JSON, FR Core and FHIR demo channels", () => {
  let session;
  before(async () => { session = await signIn(); });
  after(() => session?.close());

  test("native groups and functional tags are visible in Channels", async () => {
    const { page } = session;
    await page.locator("[data-nav-item]").filter({ hasText: /^Channels$/ }).first().click();
    for (const name of ["FML OieMessage", "FML logical", "Mapper transformer"])
      await page.getByText(`[${name}]`, { exact: true }).waitFor();
    const row = page.locator("tr").filter({ has: page.getByText("16 JSON to R5 Org - Mapper", { exact: true }) }).first();
    assert.match(await row.innerText(), /json/i);
    assert.match(await row.innerText(), /r5/i);
  });

  for (const [channel, step] of [["16 JSON to R5 Org - Mapper", "Organization"], ["19 JSON to Contained - Mapper", "DiagnosticReport"]]) {
    test(`${channel}: its saved sample matches the expected resource`, async () => {
      const { page } = session;
      await openStep(page, channel, step);
      const mapper = page.locator(".fhir-mapper-transform");
      await mapper.locator("table.mapper-tree tbody tr").first().waitFor({ timeout: 90000 });
      await mapper.getByRole("tab", { name: "Test", exact: true }).click();
      await mapper.getByRole("button", { name: /Run all/ }).click();
      const rows = mapper.locator("table[aria-label='Results of the saved samples'] tr");
      await rows.first().waitFor({ timeout: 90000 });
      await mapper.getByRole("button", { name: /Run all/ }).and(mapper.locator(":enabled")).waitFor({ timeout: 90000 });
      assert.equal(await rows.count(), 1);
      assert.match(await rows.first().innerText(), /^passed\t.*matches the expected result/);
    });
  }

  test("the FML source defaults to JSON and the result normalizes the Patient", async () => {
    const { page } = session;
    await openStep(page, "05 FHIR Patient - Normalize Identity", "Normalize Patient identity");
    const fml = page.locator(".fhir-fml");
    await fml.getByRole("tab", { name: "Test", exact: true }).click();
    assert.match(await fml.locator(".fml-test").innerText(), /JSON|FHIR/);
    await fml.getByRole("button", { name: "Run test", exact: true }).click();
    await fml.getByText("Transformation succeeded.", { exact: true }).waitFor({ timeout: 90000 });
    assert.equal(await fml.locator(".fml-error").count(), 0);
    const output = await page.evaluate(() => window.monaco.editor.getEditors().map(editor => {
      try { return JSON.parse(editor.getValue()); } catch { return null; }
    }).find(value => value?.resourceType === "Patient" && value.active === true && value.name?.[0]?.family === "MARTIN"));
    assert.equal(output.id, "demo-fhir");
    assert.equal(output.name[0].given[0], "Claire");
    assert.deepEqual(session.pluginErrors(), []);
  });

  test("FML test tabs use the available height in narrow and full screen layouts", async () => {
    const { page } = session;
    await openStep(page, "05 FHIR Patient - Normalize Identity", "Normalize Patient identity");
    const fml = page.locator(".fhir-fml");
    await fml.getByRole("tab", { name: "Test", exact: true }).click();
    await fml.getByRole("button", { name: "Run test", exact: true }).click();
    await fml.getByText("Transformation succeeded.", { exact: true }).waitFor();
    const checkLayout = async () => {
      for (const name of ["Sample", "FML source", "Result"]) {
        await fml.getByRole("tab", { name, exact: true }).click();
        await page.waitForFunction(() => window.monaco.editor.getEditors()
          .filter(e => e.getDomNode()?.closest(".fml-test-panel:not([hidden])"))
          .every(e => Math.abs(e.getLayoutInfo().height - e.getDomNode().closest(".fm-code-box").clientHeight) < 6));
        const panel = await fml.locator(".fml-test-panel:visible").boundingBox();
        assert.ok(panel.height > 200);
        assert.ok(panel.y + panel.height <= page.viewportSize().height);
        assert.deepEqual(await fml.evaluate(el => {
          const overflowing = [];
          for (let node = el; node; node = node.parentElement)
            if (node.scrollHeight > node.clientHeight + 2) overflowing.push(node.className);
          return overflowing;
        }), []);
      }
      await fml.getByRole("tab", { name: /^Validation/ }).click();
      await fml.getByText(/^Valid\.|^Validation: 0 error/).waitFor();
    };
    for (const size of [{ width: 1600, height: 900 }, { width: 1400, height: 800 }]) {
      await page.setViewportSize(size);
      await checkLayout();
    }
    await fml.getByRole("button", { name: "⤢ Full screen", exact: true }).click();
    await checkLayout();
    await fml.getByRole("button", { name: "Exit full screen (Esc)", exact: true }).click();
    await page.setViewportSize({ width: 1600, height: 1100 });
    assert.deepEqual(session.pluginErrors(), []);
  });

  test("Mapper Transform shows the prepared HL7 XML in both preview scopes without page overflow", async () => {
    const { page } = session;
    await openStep(page, "10 ORU to Lab Bundle - Mapper", "Patient");
    const mapper = page.locator(".fhir-mapper-transform");
    await mapper.locator("table.mapper-tree tbody tr").first().waitFor();
    await mapper.getByRole("tab", { name: "Test", exact: true }).click();
    await mapper.getByRole("combobox", { name: "Sample", exact: true }).selectOption("");
    const prepared = mapper.locator("#mapper-test-panel-source");
    for (const scope of ["step", "transformer"]) {
      await mapper.getByRole("tab", { name: "Sample", exact: true }).click();
      await mapper.getByRole("combobox", { name: "Preview scope", exact: true }).selectOption(scope);
      const response = page.waitForResponse(r => r.url().endsWith("/fhir-mapper/test"));
      await mapper.getByRole("button", { name: "Run test", exact: true }).click();
      const result = await (await response).json();
      assert.deepEqual(result.errors, []);
      assert.equal(result.source.dataType, "XML");
      assert.match(result.source.message, /<PID/);
      await mapper.getByRole("tab", { name: "Prepared message", exact: true }).click();
      await prepared.locator(".monaco-editor").waitFor();
      assert.equal(await page.evaluate(() => window.monaco.editor.getEditors()
        .find(e => e.getDomNode()?.closest("#mapper-test-panel-source"))?.getValue()), result.source.message);
      for (const size of [{ width: 1600, height: 900 }, { width: 1400, height: 800 }]) {
        await page.setViewportSize(size);
        await waitForCodeLayout(page);
        assert.deepEqual(await mapper.evaluate(el => {
          const overflowing = [];
          for (let node = el; node; node = node.parentElement)
            if (node.scrollHeight > node.clientHeight + 2) overflowing.push(node.className);
          return overflowing;
        }), []);
        const source = await prepared.locator(".fm-code-box").boundingBox();
        assert.ok(source.height > 100 && source.y + source.height <= size.height);
      }
    }
    await mapper.getByRole("tab", { name: "Result", exact: true }).click();
    await mapper.getByRole("button", { name: "⤢ Full screen", exact: true }).click();
    await waitForCodeLayout(page);
    const resultBox = await mapper.locator(".mapper-test-output .fm-code-box").boundingBox();
    assert.ok(resultBox.height > 100 && resultBox.y + resultBox.height <= page.viewportSize().height);
    await mapper.getByRole("button", { name: "Exit full screen (Esc)", exact: true }).click();
    await page.setViewportSize({ width: 1600, height: 1100 });
    assert.deepEqual(session.pluginErrors(), []);
  });
});
