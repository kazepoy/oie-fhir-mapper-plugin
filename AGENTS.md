# Plugin development instructions

This file is for agents modifying this repository's Java sources, frontend,
tools, tests or documentation. Instructions for agents building OIE channels
with the plugin are in the separate [agent manual](doc/agent-manual/README.md).

## Project rules

- Keep the `fr.kazepoy.fhir` namespace.
- Do not edit `webadmin/web/plugin.js` directly; rebuild it from `webadmin/src`.
- Preserve unrelated user changes, including untracked files.
- Run at least `mvn clean package` and `node --test tools/tests/*.test.mjs`. When changing
  documentation, also run `node tools/check_doc_links.mjs`.

## Documentation screenshots

- Use `npm --prefix webadmin run capture:docs` for README and manual images.
- Keep framing in `webadmin/test/e2e/capture-frame.mjs`: dark theme, reference
  panel hidden, step-list split reduced, and Mapper filter set to Mapped only.
- See `doc/fr/demo/Captures.md`; update the routine when a screenshot needs a
  framing adjustment so the next capture reproduces it.
