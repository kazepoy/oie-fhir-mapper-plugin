// Unit tests for tools/check_security.mjs.
// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSecuritySummaryMarkdown, checkSecurity, stripComments } from "../check_security.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function withTempRepo(setup) {
  const dir = mkdtempSync(join(tmpdir(), "fhir-mapper-sec-"));
  try {
    setup(dir);
    return checkSecurity(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRepoFile(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

test("repository passes offline security checks", () => {
  const result = checkSecurity(ROOT);
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
});

test("stripComments removes comments while keeping strings and line numbers", () => {
  const stripped = stripComments('const a = "// keep"; // drop\n/* multi\nline */const b = 1;');
  assert.match(stripped, /"\/\/ keep"/);
  assert.doesNotMatch(stripped, /drop/);
  assert.doesNotMatch(stripped, /multi/);
  assert.equal(stripped.split("\n").length, 3);
});

test("detects unguarded JAX-RS route missing ExtensionPermission declaration", () => {
  const result = withTempRepo((dir) => {
    writeRepoFile(
      dir,
      "src/main/java/fr/kazepoy/fhir/mapper/DemoServletInterface.java",
      `package fr.kazepoy.fhir.mapper;
public interface DemoServletInterface {
  @GET @Path("/a") @MirthOperation(name = "opA", display = "A", permission = PERMISSION_EDIT) String a();
  @POST @Path("/b") String b();
}`,
    );
    writeRepoFile(
      dir,
      "src/main/java/fr/kazepoy/fhir/mapper/server/DemoPlugin.java",
      `package fr.kazepoy.fhir.mapper.server;
public class DemoPlugin {
  public ExtensionPermission[] getExtensionPermissions() {
    return new ExtensionPermission[] { new ExtensionPermission(n, p, d, new String[] { "opA", "opStale" }, new String[0]) };
  }
}`,
    );
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.rule === "rbac-route-mismatch"));
  assert.ok(result.findings.some((f) => f.rule === "rbac-stale-operation"));
});

test("detects XML factory without XXE guard and JS unsafe DOM/eval sinks", () => {
  const result = withTempRepo((dir) => {
    writeRepoFile(
      dir,
      "src/main/java/fr/kazepoy/fhir/mapper/BadXml.java",
      `package fr.kazepoy.fhir.mapper;
class BadXml { void parse() { DocumentBuilderFactory f = DocumentBuilderFactory.newInstance(); } }`,
    );
    writeRepoFile(dir, "webadmin/src/bad.js", "el.innerHTML = userInput; eval('1+1');");
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.rule === "java-xxe-guard"));
  assert.ok(result.findings.some((f) => f.rule === "js-inner-html"));
  assert.ok(result.findings.some((f) => f.rule === "js-eval"));
});

test("detects curl downloads without sha256sum verification", () => {
  const result = withTempRepo((dir) => {
    writeRepoFile(dir, "demo/Dockerfile", "FROM alpine\nRUN curl -fsSL https://example.org/app.zip -o /tmp/app.zip\n");
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.rule === "download-missing-sha256"));
});

test("buildSecuritySummaryMarkdown summarizes offline checks, SBOM findings and scanners", () => {
  const reportDir = mkdtempSync(join(tmpdir(), "fhir-mapper-sec-summary-"));
  try {
    writeFileSync(join(reportDir, "maven-sbom.json"), JSON.stringify({ components: [{ name: "xstream" }, { name: "guava" }] }));
    writeFileSync(
      join(reportDir, "trivy-maven-sbom.json"),
      JSON.stringify({
        Results: [
          {
            Target: "Java",
            Vulnerabilities: [
              {
                PkgName: "com.thoughtworks.xstream:xstream",
                VulnerabilityID: "CVE-2024-47072",
                Severity: "HIGH",
                InstalledVersion: "1.4.20",
                FixedVersion: "1.4.21",
              },
            ],
          },
        ],
      }),
    );
    writeFileSync(join(reportDir, "trivy-package.json"), JSON.stringify({ Results: [] }));
    writeFileSync(join(reportDir, "gitleaks-git.json"), "[]");
    writeFileSync(join(reportDir, "gitleaks-dir.json"), "[]");
    writeFileSync(join(reportDir, "semgrep.json"), JSON.stringify({ results: [], paths: { scanned: ["a.java"] } }));

    const md = buildSecuritySummaryMarkdown({
      offline: { ok: true, checks: [{ name: "rbac-coverage", checked: 2, findings: [] }], findings: [] },
      scanners: [
        { name: "maven-sbom (CycloneDX + Trivy)", ok: true },
        { name: "gitleaks (Docker Compose)", ok: true },
        { name: "semgrep (Docker Compose)", ok: true },
      ],
      outDir: reportDir,
      gitHead: "main (abc1234)",
      generatedAt: "2026-11-15T08:30:00Z",
    });

    assert.match(md, /\*\*PASS\*\*/);
    assert.match(md, /2 composants Maven résolus — 0 critical, 1 high/);
    assert.match(md, /archive ZIP : 0 vuln\./);
    assert.match(md, /`CVE-2024-47072`/);
    assert.match(md, /0 alerte\(s\) sur 1 fichiers/);
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
});
