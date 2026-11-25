#!/usr/bin/env node
// Déplier un export XML OIE en arborescence lisible pour Git, et le réassembler.
// SPDX-License-Identifier: MPL-2.0

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { encodeXml, FML_TYPE, steps, TYPE } from "./channel_mapping.mjs";

function slugify(value, fallback = "step") {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function sampleExt(sample) {
  const dt = String(sample?.dataType || "").toUpperCase();
  const msg = String(sample?.message || "").trimStart();
  if (dt === "JSON" || msg.startsWith("{") || msg.startsWith("[")) return ".json";
  if (dt === "XML" || msg.startsWith("<")) return ".xml";
  if (dt === "HL7V2" || msg.startsWith("MSH|")) return ".hl7";
  return ".txt";
}

function tryParseJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function unpackSamples(stepDir, rawSamples) {
  const parsed = tryParseJson(rawSamples);
  if (!Array.isArray(parsed)) return false;
  const samplesDir = join(stepDir, "samples");
  mkdirSync(samplesDir, { recursive: true });
  const index = parsed.map((sample, idx) => {
    const num = String(idx + 1).padStart(2, "0");
    const name = slugify(sample.id || sample.name, `sample-${num}`);
    const file = `${num}-${name}${sampleExt(sample)}`;
    const { message = "", ...meta } = sample;
    writeFileSync(join(samplesDir, file), String(message), "utf8");
    return { ...meta, messageFile: file };
  });
  writeJson(join(samplesDir, "index.json"), index);
  return true;
}

function packSamples(stepDir, stepObj) {
  const indexPath = join(stepDir, "samples", "index.json");
  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    return;
  }
  const samples = index.map((entry) => {
    const { messageFile, ...meta } = entry;
    const message = readFileSync(join(stepDir, "samples", messageFile), "utf8");
    return { ...meta, message };
  });
  stepObj.samples = JSON.stringify(samples);
}

export function unpackChannel(xml, outDir) {
  const [, entries] = steps(xml, { includeFml: true });
  rmSync(join(outDir, "steps"), { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const replacements = [];
  for (const [cid, kind, node, step] of entries) {
    const seq = String(step.sequenceNumber ?? "0").padStart(2, "0");
    const relDir = join("steps", `${cid}-${kind}`, `${seq}-${slugify(step.name)}`);
    const stepDir = join(outDir, relDir);
    mkdirSync(stepDir, { recursive: true });

    const openTagEnd = node.xml.indexOf(">");
    const openTag = node.xml.slice(0, openTagEnd + 1);
    const indentMatch = node.xml.match(/\n([ \t]+)<[A-Za-z0-9_.-]+/);
    const childIndent = indentMatch ? indentMatch[1] : "          ";
    const closeIndentMatch = node.xml.match(/\n([ \t]*)<\/[^>]+>\s*$/);
    const closeIndent = closeIndentMatch ? closeIndentMatch[1] : "        ";

    const meta = {
      __type: step.__type,
      _xml: { openTag, childIndent, closeIndent, fieldOrder: Object.keys(step) },
    };

    const stepJson = {};
    for (const [key, val] of Object.entries(step)) {
      if (step.__type === TYPE && key === "mappings") {
        const parsed = tryParseJson(val);
        if (Array.isArray(parsed)) {
          writeJson(join(stepDir, "mappings.json"), parsed);
          continue;
        }
      }
      if (step.__type === TYPE && key === "bundleTargets") {
        const parsed = tryParseJson(val);
        if (Array.isArray(parsed)) {
          writeJson(join(stepDir, "bundle-targets.json"), parsed);
          continue;
        }
      }
      if (step.__type === FML_TYPE && key === "mapSource") {
        writeFileSync(join(stepDir, "transform.fml"), String(val), "utf8");
        continue;
      }
      if (step.__type === FML_TYPE && key === "contextVariables") {
        const parsed = tryParseJson(val);
        if (parsed !== null) {
          writeJson(join(stepDir, "context-variables.json"), parsed);
          continue;
        }
      }
      if (key === "samples" && unpackSamples(stepDir, val)) {
        continue;
      }
      stepJson[key] = val;
    }

    writeJson(join(stepDir, "step.json"), { ...meta, ...stepJson });
    const markerRel = relDir.replaceAll("\\", "/");
    replacements.push({ start: node.start, end: node.end, text: `<!-- @step: ${markerRel} -->` });
  }

  replacements.sort((a, b) => b.start - a.start);
  let skeleton = xml;
  for (const r of replacements) {
    skeleton = skeleton.slice(0, r.start) + r.text + skeleton.slice(r.end);
  }
  writeFileSync(join(outDir, "channel.xml"), skeleton, "utf8");
  return { stepsCount: entries.length };
}

function readOptionalJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function readOptionalText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export function packChannel(inDir) {
  const skeleton = readFileSync(join(inDir, "channel.xml"), "utf8");
  return skeleton.replace(/<!-- @step: ([^\s]+?) -->/g, (_, relDir) => {
    const stepDir = join(inDir, relDir);
    const raw = JSON.parse(readFileSync(join(stepDir, "step.json"), "utf8"));
    const { __type, _xml = {}, ...fields } = raw;
    const tag = __type || TYPE;
    const openTag = _xml.openTag || `<${tag}>`;
    const childIndent = _xml.childIndent || "          ";
    const closeIndent = _xml.closeIndent || "        ";
    const fieldOrder = Array.isArray(_xml.fieldOrder) ? _xml.fieldOrder : [];

    const assembled = { ...fields };
    const mappings = readOptionalJson(join(stepDir, "mappings.json"));
    if (mappings !== undefined) assembled.mappings = JSON.stringify(mappings);
    const bundleTargets = readOptionalJson(join(stepDir, "bundle-targets.json"));
    if (bundleTargets !== undefined) assembled.bundleTargets = JSON.stringify(bundleTargets);
    const fml = readOptionalText(join(stepDir, "transform.fml"));
    if (fml !== undefined) assembled.mapSource = fml;
    const ctxVars = readOptionalJson(join(stepDir, "context-variables.json"));
    if (ctxVars !== undefined) assembled.contextVariables = JSON.stringify(ctxVars);
    packSamples(stepDir, assembled);

    const orderedKeys = [
      ...fieldOrder.filter((k) => k in assembled),
      ...Object.keys(assembled).filter((k) => !fieldOrder.includes(k)),
    ];
    const children = orderedKeys
      .map((key) => `${childIndent}<${key}>${encodeXml(assembled[key] ?? "")}</${key}>`)
      .join("\n");
    return `${openTag}\n${children}\n${closeIndent}</${tag}>`;
  });
}

export function main(argv = process.argv.slice(2)) {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        out: { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: true,
    });
    const [command, target] = positionals;
    if (command === "unpack" && target && (values.out || values.output)) {
      const xml = readFileSync(target, "utf8");
      const outDir = resolve(values.out || values.output);
      const { stepsCount } = unpackChannel(xml, outDir);
      process.stdout.write(`Unpacked ${stepsCount} step(s) to ${outDir}\n`);
      return 0;
    }
    if (command === "pack" && target) {
      const xml = packChannel(resolve(target));
      if (values.out || values.output) {
        writeFileSync(resolve(values.out || values.output), xml, "utf8");
      } else {
        process.stdout.write(xml);
      }
      return 0;
    }
    throw new Error("Usage: node tools/channel_bundle.mjs <unpack <channel.xml> --out <dir> | pack <dir> [--out <channel.xml>]>");
  } catch (err) {
    console.error(err.message);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
