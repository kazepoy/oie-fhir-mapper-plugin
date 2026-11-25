// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { packChannel, unpackChannel } from "../channel_bundle.mjs";
import { FML_TYPE, steps, TYPE } from "../channel_mapping.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHANNELS_DIR = join(ROOT, "demo/oie-init/data/channels");

test("all demo channels unpack to readable files and pack back losslessly", () => {
  const workDir = mkdtempSync(join(tmpdir(), "oie-channel-bundle-"));
  try {
    const files = readdirSync(CHANNELS_DIR).filter((f) => f.endsWith(".xml")).sort();
    assert.ok(files.length > 0);
    for (const file of files) {
      const originalXml = readFileSync(join(CHANNELS_DIR, file), "utf8");
      const [, origEntries] = steps(originalXml, { includeFml: true });
      const outDir = join(workDir, file.replace(/\.xml$/, ""));
      const { stepsCount } = unpackChannel(originalXml, outDir);
      assert.equal(stepsCount, origEntries.length, `Step count mismatch for ${file}`);

      const skeleton = readFileSync(join(outDir, "channel.xml"), "utf8");
      assert.equal(skeleton.includes(`<${TYPE}`), false);
      assert.equal(skeleton.includes(`<${FML_TYPE}`), false);

      const packedXml = packChannel(outDir);
      const [, packedEntries] = steps(packedXml, { includeFml: true });
      assert.equal(packedEntries.length, origEntries.length);

      for (let i = 0; i < origEntries.length; i++) {
        const [origCid, origKind, , origStep] = origEntries[i];
        const [packCid, packKind, , packStep] = packedEntries[i];
        assert.equal(packCid, origCid);
        assert.equal(packKind, origKind);
        assert.equal(packStep.__type, origStep.__type);
        assert.deepEqual(Object.keys(packStep), Object.keys(origStep));
        for (const key of Object.keys(origStep)) {
          if (["mappings", "bundleTargets", "samples", "contextVariables"].includes(key)) {
            const origVal = origStep[key];
            const packVal = packStep[key];
            try {
              assert.deepEqual(JSON.parse(packVal), JSON.parse(origVal));
            } catch {
              assert.equal(packVal, origVal);
            }
          } else {
            assert.equal(packStep[key], origStep[key], `Mismatch on ${file} step ${i} key ${key}`);
          }
        }
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("editing unpacked mappings.json, transform.fml and samples updates the packed XML", () => {
  const workDir = mkdtempSync(join(tmpdir(), "oie-channel-edit-"));
  try {
    const mapperXml = readFileSync(join(CHANNELS_DIR, "10-oru-lab-transaction-mapper.xml"), "utf8");
    const mapperDir = join(workDir, "mapper");
    unpackChannel(mapperXml, mapperDir);

    const stepDir = join(mapperDir, "steps", "0-transformer", "02-patient");
    assert.ok(existsSync(join(stepDir, "mappings.json")));
    const mappings = JSON.parse(readFileSync(join(stepDir, "mappings.json"), "utf8"));
    mappings[0].note = "Edited in unpacked tree";
    writeFileSync(join(stepDir, "mappings.json"), JSON.stringify(mappings, null, 2) + "\n", "utf8");

    const packedMapper = packChannel(mapperDir);
    const [, entries] = steps(packedMapper);
    const patientStep = entries.find(([, , , s]) => s.name === "Patient")[3];
    assert.equal(JSON.parse(patientStep.mappings)[0].note, "Edited in unpacked tree");

    const fmlXml = readFileSync(join(CHANNELS_DIR, "01-adt-a28-patient-inline-fml.xml"), "utf8");
    const fmlDir = join(workDir, "fml");
    unpackChannel(fmlXml, fmlDir);
    const fmlStepsRoot = join(fmlDir, "steps");
    const firstConnectorDir = readdirSync(fmlStepsRoot)[0];
    const firstStepDir = join(fmlStepsRoot, firstConnectorDir, readdirSync(join(fmlStepsRoot, firstConnectorDir))[0]);
    const fmlPath = join(firstStepDir, "transform.fml");
    assert.ok(existsSync(fmlPath));
    const updatedFml = readFileSync(fmlPath, "utf8") + "\n// edited\n";
    writeFileSync(fmlPath, updatedFml, "utf8");

    const packedFml = packChannel(fmlDir);
    const [, fmlEntries] = steps(packedFml, { includeFml: true });
    assert.ok(fmlEntries[0][3].mapSource.endsWith("// edited\n"));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
