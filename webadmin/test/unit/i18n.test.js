// SPDX-License-Identifier: MPL-2.0
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { t, resolveLocale, setLocale, currentLocale, localePreference, setLocalePreference, catalogs } from "../../src/i18n/index.js";
import { compile, indexSd, makeTree } from "../../src/fhir/model.js";
import { FhirSettingsPanel } from "../../src/settings/panel.js";

afterEach(() => setLocale(["en"]));
test("Settings panel places the New context button at the top, prepends new contexts and switches language", () => {
  setLocale(["fr-FR"]);
  let contexts = [{ name: "demo-labo", fhirVersion: "R4", packages: [], terminologyServer: "", terminologyAuthorization: "", cacheSeconds: 300, timeoutSeconds: 10, validation: "always" }];
  let langPref = localePreference();
  const states = [
    [() => contexts, next => { contexts = next; }],
    [() => "", () => {}],
    [() => false, () => {}],
    [() => false, () => {}],
    [() => langPref, next => { langPref = next; }]
  ];
  const render = () => {
    let idx = 0;
    const React = {
      createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }),
      useState: init => { const entry = states[idx++]; return entry ? [entry[0](), entry[1]] : [init, () => {}]; },
      useRef: value => ({ current: value }),
      useEffect: () => {}
    };
    return FhirSettingsPanel({ platform: { React } });
  };
  const tree = render();
  const topBar = tree.children[0];
  const newBtn = topBar.children[0];
  assert.equal(newBtn.tag, "button");
  assert.deepEqual(newBtn.children, ["Nouveau contexte"]);
  newBtn.props.onClick();
  assert.deepEqual(contexts.map(c => c.name), ["", "demo-labo"]);
  const langSelect = topBar.children[1].children[0].children[1];
  assert.equal(langSelect.tag, "select");
  assert.equal(langSelect.props["aria-label"], "Langue");
  langSelect.props.onChange({ target: { value: "en" } });
  assert.equal(localePreference(), "en");
  assert.equal(currentLocale(), "en");
  assert.equal(langPref, "en");
  const enTree = render();
  assert.deepEqual(enTree.children[0].children[0].children, ["New context"]);
  setLocalePreference("auto");
  assert.equal(localePreference(), "auto");
});
test("the first supported browser language is used, with English as fallback", () => {
  assert.equal(resolveLocale(["es-ES", "fr-CA"]), "fr");
  assert.equal(resolveLocale(["en-AU", "fr"]), "en");
  assert.equal(resolveLocale(["FR-fr"]), "fr");
  assert.equal(resolveLocale(["constructor", "zh-CN"]), "en");
  assert.equal(resolveLocale([]), "en");
});
test("French UI text interpolates values once and leaves unknown technical text intact", () => {
  setLocale(["fr-FR"]);
  assert.equal(currentLocale(), "fr");
  assert.equal(t("common.properties"), "Propriétés");
  assert.equal(t("mapper.inspect_p0", { p0: "Patient.name[{p0}]" }), "Inspecter Patient.name[{p0}]");
  assert.equal(t("server error: Patient.active"), "server error: Patient.active");
  assert.equal(t("constructor"), "constructor");
  assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs.fr).sort());
});
test("changing locale does not change generated rules, FHIR paths or expressions", () => {
  const definition = indexSd({ type: "Patient", snapshot: { element: [
    { id: "Patient", path: "Patient" }, { id: "Patient.active", path: "Patient.active", min: 0, max: "1", type: [{ code: "boolean" }] }
  ] } });
  const build = () => compile(makeTree(definition, { version: "R4", profiles: "", instances: new Map(), showAll: true }),
    new Map([["Patient.active", "msg.active"]]), new Map(), new Map(), new Map());
  const english = build();
  setLocale(["fr"]);
  assert.deepEqual(build(), english);
  assert.equal(english[0].expression, "msg.active");
});
