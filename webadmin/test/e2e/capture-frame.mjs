// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";

/** Shared framing for every README/manual screenshot of a transformer plugin. */
export async function preparePluginCapture(page, { mapper = false } = {}) {
  const hideReference = page.getByRole("button", { name: "Hide the reference panel", exact: true });
  if (await hideReference.isVisible()) await hideReference.click();
  const list = page.locator(".element-list-pane");
  const box = await list.boundingBox();
  if (box && box.height > 150) {
    const handle = page.locator(".split.vertical > .split-handle").first();
    const grip = await handle.boundingBox();
    assert.ok(grip, "The transformer split handle must be available");
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, box.y + 140, { steps: 8 });
    await page.mouse.up();
  }
  if (mapper) {
    const plugin = page.locator(".fhir-mapper-transform");
    await plugin.getByRole("tab", { name: "Mapper", exact: true }).click();
    await plugin.locator(".mapper-toolbar select").first().selectOption("mapped");
    await plugin.getByRole("button", { name: "Expand mapped", exact: true }).click();
    assert.equal(await plugin.locator(".mapper-toolbar select").first().inputValue(), "mapped");
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => (window.monaco?.editor.getEditors() || []).every(editor => {
    const node = editor.getDomNode();
    if (!node?.getBoundingClientRect().height) return true;
    const parent = node.closest(".fm-code-box, .fml-map-editor");
    return !parent || Math.abs(editor.getLayoutInfo().height - parent.clientHeight) < 6;
  }));
  assert.equal(await hideReference.isVisible(), false, "The right panel must stay collapsed");
}
