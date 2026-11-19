#!/usr/bin/env node
// Local security checks for OIE FHIR Mapper: offline static checks and optional Docker scanners.
// SPDX-License-Identifier: MPL-2.0

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORED_DIRS = new Set([".git", "node_modules", "target", "reports", "output"]);

function walkFiles(dir, predicate) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full, predicate));
    } else if (entry.isFile() && predicate(full)) {
      files.push(full);
    }
  }
  return files.sort();
}

/** Strips // and /* * / comments while keeping string literals and line breaks intact. */
export function stripComments(source) {
  let out = "";
  let i = 0;
  let quote = "";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] || "";
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < source.length) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = "";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < source.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** Verifies every JAX-RS route has @MirthOperation and matches getExtensionPermissions(). */
export function checkRbacCoverage(root = ROOT) {
  const findings = [];
  const javaRoot = join(root, "src/main/java");
  const javaFiles = walkFiles(javaRoot, (f) => f.endsWith(".java"));
  const servlets = new Map();
  const plugins = new Map();

  for (const file of javaFiles) {
    const rel = relative(root, file).replaceAll("\\", "/");
    const code = stripComments(readFileSync(file, "utf8"));
    const pkgMatch = code.match(/\bpackage\s+([\w.]+)\s*;/);
    const pkg = pkgMatch ? pkgMatch[1] : "";
    const topPkg = pkg.split(".").slice(0, 4).join(".");

    const routeMatches = [...code.matchAll(/@(?:GET|POST|PUT|DELETE)\b/g)];
    if (routeMatches.length > 0 && !file.endsWith("ServletInterface.java")) {
      findings.push({
        rule: "rbac-unexpected-route",
        file: rel,
        line: lineNumberAt(code, routeMatches[0].index),
        message: "JAX-RS HTTP annotation found outside *ServletInterface.java",
      });
    }

    if (file.endsWith("ServletInterface.java")) {
      const ops = [];
      for (const match of code.matchAll(/@MirthOperation\s*\(([^)]+)\)/g)) {
        const body = match[1];
        const name = body.match(/\bname\s*=\s*"([^"]+)"/)?.[1] || "";
        const permission = body.match(/\bpermission\s*=\s*([^,\s)]+)/)?.[1] || "";
        if (!name || !permission) {
          findings.push({
            rule: "rbac-incomplete-operation",
            file: rel,
            line: lineNumberAt(code, match.index),
            message: "@MirthOperation must specify both name and permission",
          });
        } else {
          ops.push({ name, permission, line: lineNumberAt(code, match.index) });
        }
      }
      if (ops.length !== routeMatches.length) {
        findings.push({
          rule: "rbac-route-mismatch",
          file: rel,
          line: 1,
          message: `${routeMatches.length} HTTP method(s) vs ${ops.length} @MirthOperation annotation(s)`,
        });
      }
      servlets.set(topPkg, { file: rel, ops });
    }

    if (/getExtensionPermissions\s*\(/.test(code)) {
      const declared = new Set();
      for (const permMatch of code.matchAll(/new\s+ExtensionPermission\s*\([\s\S]*?new\s+String\s*\[\s*\]\s*\{([^}]*)\}/g)) {
        for (const str of permMatch[1].matchAll(/"([^"]+)"/g)) {
          declared.add(str[1]);
        }
      }
      plugins.set(topPkg, { file: rel, declared });
    }
  }

  for (const [topPkg, servlet] of servlets) {
    const plugin = plugins.get(topPkg);
    if (!plugin) {
      findings.push({
        rule: "rbac-missing-plugin",
        file: servlet.file,
        line: 1,
        message: `No ExtensionPermission declaration found for package ${topPkg}`,
      });
      continue;
    }
    const opNames = new Set(servlet.ops.map((op) => op.name));
    for (const op of servlet.ops) {
      if (!plugin.declared.has(op.name)) {
        findings.push({
          rule: "rbac-undeclared-operation",
          file: servlet.file,
          line: op.line,
          message: `Operation "${op.name}" is missing from ${plugin.file} getExtensionPermissions()`,
        });
      }
    }
    for (const name of plugin.declared) {
      if (!opNames.has(name)) {
        findings.push({
          rule: "rbac-stale-operation",
          file: plugin.file,
          line: 1,
          message: `Declared permission operation "${name}" is not present on ${servlet.file}`,
        });
      }
    }
  }

  return { name: "rbac-coverage", checked: servlets.size, findings };
}

/** Verifies XML factories disable DOCTYPE/XXE and enable secure processing. */
export function checkXmlXxeHardening(root = ROOT) {
  const findings = [];
  const javaFiles = walkFiles(join(root, "src/main/java"), (f) => f.endsWith(".java"));
  const factories = /\b(?:DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|TransformerFactory|SchemaFactory)\s*\.\s*newInstance\s*\(/g;
  let checked = 0;

  for (const file of javaFiles) {
    const rel = relative(root, file).replaceAll("\\", "/");
    const code = stripComments(readFileSync(file, "utf8"));
    const matches = [...code.matchAll(factories)];
    if (matches.length === 0) continue;
    checked++;
    const hasDoctypeGuard =
      code.includes("disallow-doctype-decl") ||
      code.includes("IS_SUPPORTING_EXTERNAL_ENTITIES") ||
      code.includes("ACCESS_EXTERNAL_DTD");
    const hasSecureProcessing =
      code.includes("FEATURE_SECURE_PROCESSING") ||
      code.includes("ACCESS_EXTERNAL_STYLESHEET");
    if (!hasDoctypeGuard || !hasSecureProcessing) {
      findings.push({
        rule: "java-xxe-guard",
        file: rel,
        line: lineNumberAt(code, matches[0].index),
        message: "XML parser factory must disable DOCTYPE/external entities and enable FEATURE_SECURE_PROCESSING",
      });
    }
  }
  return { name: "java-xxe-hardening", checked, findings };
}

/** Flags custom TrustManager / HostnameVerifier or shell exec sinks in Java production code. */
export function checkJavaDangerousApis(root = ROOT) {
  const findings = [];
  const javaFiles = walkFiles(join(root, "src/main/java"), (f) => f.endsWith(".java"));
  const patterns = [
    { rule: "java-trust-bypass", re: /\b(?:X509TrustManager|HostnameVerifier)\b/, message: "Custom TLS validation requires explicit security review" },
    { rule: "java-exec", re: /\b(?:ProcessBuilder|getRuntime\s*\(\s*\)\s*\.\s*exec)\b/, message: "OS command execution is disallowed in plugin runtime" },
    { rule: "java-object-deser", re: /\bnew\s+ObjectInputStream\b/, message: "Java native deserialization (ObjectInputStream) is disallowed" },
  ];
  for (const file of javaFiles) {
    const rel = relative(root, file).replaceAll("\\", "/");
    const code = stripComments(readFileSync(file, "utf8"));
    for (const { rule, re, message } of patterns) {
      const match = code.match(re);
      if (match) {
        findings.push({ rule, file: rel, line: lineNumberAt(code, match.index), message });
      }
    }
  }
  return { name: "java-dangerous-apis", checked: javaFiles.length, findings };
}

/** Checks Web Admin sources and embedded JS runtimes for DOM XSS or dynamic code execution sinks. */
export function checkJsUnsafeSinks(root = ROOT) {
  const findings = [];
  const targets = [
    ...walkFiles(join(root, "webadmin/src"), (f) => f.endsWith(".js")),
    ...walkFiles(join(root, "src/main/resources"), (f) => f.endsWith(".js")),
  ];
  const patterns = [
    { rule: "js-eval", re: /\beval\s*\(/, message: "Dynamic eval() is disallowed" },
    { rule: "js-new-function", re: /\bnew\s+Function\s*\(/, message: "Dynamic new Function() is disallowed" },
    { rule: "js-inner-html", re: /\.\s*(?:innerHTML|outerHTML)\s*=/, message: "Direct innerHTML/outerHTML assignment is disallowed" },
    { rule: "js-insert-adjacent-html", re: /\.\s*insertAdjacentHTML\s*\(/, message: "insertAdjacentHTML() is disallowed" },
    { rule: "js-document-write", re: /\bdocument\s*\.\s*write(?:ln)?\s*\(/, message: "document.write() is disallowed" },
  ];

  for (const file of targets) {
    const rel = relative(root, file).replaceAll("\\", "/");
    const code = stripComments(readFileSync(file, "utf8"));
    for (const { rule, re, message } of patterns) {
      const match = code.match(re);
      if (match) {
        findings.push({ rule, file: rel, line: lineNumberAt(code, match.index), message });
      }
    }
  }
  return { name: "js-unsafe-sinks", checked: targets.length, findings };
}

/** Verifies external downloads in Dockerfiles and workflows check SHA-256 checksums. */
export function checkDownloadChecksums(root = ROOT) {
  const findings = [];
  let checked = 0;

  const dockerfile = join(root, "demo/Dockerfile");
  if (existsSync(dockerfile)) {
    checked++;
    const content = readFileSync(dockerfile, "utf8");
    const runBlocks = [...content.matchAll(/^RUN\s+(?:[^\n]*\\\r?\n)*[^\n]*/gm)];
    for (const block of runBlocks) {
      const curls = (block[0].match(/\bcurl\b/g) || []).length;
      const checks = (block[0].match(/\bsha256sum\s+-c\b/g) || []).length;
      if (curls > checks) {
        findings.push({
          rule: "download-missing-sha256",
          file: "demo/Dockerfile",
          line: lineNumberAt(content, block.index),
          message: `RUN block has ${curls} curl download(s) but only ${checks} sha256sum -c verification(s)`,
        });
      }
    }
  }

  for (const wf of walkFiles(join(root, ".github/workflows"), (f) => /\.ya?ml$/.test(f))) {
    checked++;
    const rel = relative(root, wf).replaceAll("\\", "/");
    const content = readFileSync(wf, "utf8");
    for (const match of content.matchAll(/\bcurl\b[^\n]*(?:\n[ \t]+[^\n]*)*/g)) {
      const line = lineNumberAt(content, match.index);
      const windowEnd = content.indexOf("\n      - ", match.index + 1);
      const stepChunk = content.slice(match.index, windowEnd === -1 ? content.length : windowEnd);
      if (!/\bsha256sum\s+-c\b/.test(stepChunk)) {
        findings.push({
          rule: "download-missing-sha256",
          file: rel,
          line,
          message: "Workflow curl download step is missing sha256sum -c verification",
        });
      }
    }
  }
  return { name: "download-checksums", checked, findings };
}

export function checkSecurity(root = ROOT) {
  const resolved = resolve(root);
  const checks = [
    checkRbacCoverage(resolved),
    checkXmlXxeHardening(resolved),
    checkJavaDangerousApis(resolved),
    checkJsUnsafeSinks(resolved),
    checkDownloadChecksums(resolved),
  ];
  const findings = checks.flatMap((c) => c.findings);
  return { ok: findings.length === 0, checks, findings };
}

function runCommand(cmd, args, cwd = ROOT) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function collectTrivySummary(report) {
  if (!report || !Array.isArray(report.Results)) return null;
  const vulnerabilities = [];
  const misconfigurations = [];
  const secrets = [];
  let packages = 0;

  for (const result of report.Results) {
    if (Array.isArray(result.Packages)) packages += result.Packages.length;
    for (const v of result.Vulnerabilities || []) {
      vulnerabilities.push({ target: result.Target || "", ...v });
    }
    for (const m of result.Misconfigurations || []) {
      misconfigurations.push({ target: result.Target || "", ...m });
    }
    for (const s of result.Secrets || []) {
      secrets.push({ target: result.Target || "", ...s });
    }
  }

  const countBySeverity = (items) => items.reduce((acc, item) => {
    const key = String(item.Severity || "UNKNOWN").toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    artifactName: report.ArtifactName || "",
    packages,
    vulnerabilities,
    misconfigurations,
    secrets,
    vulnBySeverity: countBySeverity(vulnerabilities),
    misconfigBySeverity: countBySeverity(misconfigurations),
  };
}

function escapeMdCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function readGitRevision(root) {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    return `${branch} (${commit})`;
  } catch {
    return "n/a";
  }
}

/** Builds a Markdown security & SBOM synthesis from offline check results and JSON reports in outDir. */
export function buildSecuritySummaryMarkdown({
  offline,
  scanners = [],
  outDir = join(ROOT, "tools/security/reports"),
  gitHead = readGitRevision(ROOT),
  generatedAt = new Date().toISOString(),
}) {
  const npmAudit = readJsonIfExists(join(outDir, "npm-audit.json"));
  const trivyFs = collectTrivySummary(readJsonIfExists(join(outDir, "trivy-fs.json")));
  const trivyPkg = collectTrivySummary(readJsonIfExists(join(outDir, "trivy-package.json")));
  const trivySbom = collectTrivySummary(readJsonIfExists(join(outDir, "trivy-maven-sbom.json")));
  const trivyImage = collectTrivySummary(readJsonIfExists(join(outDir, "trivy-image.json")));
  const mavenBom = readJsonIfExists(join(outDir, "maven-sbom.json"));
  const gitleaksGit = readJsonIfExists(join(outDir, "gitleaks-git.json"));
  const gitleaksDir = readJsonIfExists(join(outDir, "gitleaks-dir.json"));
  const semgrep = readJsonIfExists(join(outDir, "semgrep.json"));

  const scannersOk = scanners.every((r) => r.ok);
  const globalStatus = offline.ok && scannersOk ? "PASS" : "FAIL";
  const lines = [
    "# Synthèse d’analyse sécurité locale",
    "",
    `- **Date (UTC)** : ${generatedAt}`,
    `- **Branche / commit** : ${gitHead}`,
    `- **Statut global** : **${globalStatus}**`,
    "",
    "## 1. Contrôles statiques hors ligne",
    "",
    "| Règle | Éléments vérifiés | Statut | Alertes |",
    "| --- | ---: | --- | ---: |",
  ];

  for (const c of offline.checks) {
    lines.push(`| \`${c.name}\` | ${c.checked} | ${c.findings.length === 0 ? "OK" : "FAIL"} | ${c.findings.length} |`);
  }

  if (offline.findings.length > 0) {
    lines.push("", "### Alertes statiques hors ligne", "");
    for (const f of offline.findings) {
      lines.push(`- \`${f.file}:${f.line}\` [\`${f.rule}\`] ${f.message}`);
    }
  }

  const runByName = new Map(scanners.map((r) => [r.name, r]));
  const scannerStatus = (name, hasReport) => {
    const run = runByName.get(name);
    if (run) return run.ok ? "OK" : `FAIL (exit ${run.status})`;
    return hasReport ? "Rapport présent" : "Non exécuté";
  };

  lines.push(
    "",
    "## 2. Scanners locaux & SBOM",
    "",
    "| Outil | Statut | Détail |",
    "| --- | --- | --- |",
  );

  if (npmAudit || runByName.has("npm audit (--audit-level=high)")) {
    const v = npmAudit?.metadata?.vulnerabilities;
    const deps = npmAudit?.metadata?.dependencies;
    const detail = v
      ? `${v.critical || 0} critical, ${v.high || 0} high, ${v.moderate || 0} moderate, ${v.low || 0} low (${deps?.total ?? "?"} deps)`
      : "—";
    lines.push(`| \`npm audit\` | ${scannerStatus("npm audit (--audit-level=high)", Boolean(npmAudit))} | ${detail} |`);
  }

  if (trivyFs || runByName.has("trivy-fs (Docker Compose)")) {
    const detail = trivyFs
      ? `${trivyFs.vulnerabilities.length} vuln., ${trivyFs.misconfigurations.length} misconfig, ${trivyFs.secrets.length} secret(s) (${trivyFs.packages} paquets)`
      : "—";
    lines.push(`| \`trivy-fs\` | ${scannerStatus("trivy-fs (Docker Compose)", Boolean(trivyFs))} | ${detail} |`);
  }

  if (mavenBom || trivySbom || trivyPkg || runByName.has("maven-sbom (CycloneDX + Trivy)")) {
    const bomCount = Array.isArray(mavenBom?.components) ? mavenBom.components.length : null;
    const crit = trivySbom?.vulnBySeverity?.CRITICAL || 0;
    const high = trivySbom?.vulnBySeverity?.HIGH || 0;
    const pkgDetail = trivyPkg
      ? `, archive ZIP : ${trivyPkg.vulnerabilities.length} vuln.`
      : "";
    const detail = `${bomCount !== null ? `${bomCount} composants Maven résolus` : "SBOM absent"}`
      + (trivySbom ? ` — ${crit} critical, ${high} high (scopes \`provided\`/\`test\`)` : "")
      + pkgDetail;
    lines.push(`| \`maven-sbom\` + \`trivy-sbom\` | ${scannerStatus("maven-sbom (CycloneDX + Trivy)", Boolean(trivySbom))} | ${detail} |`);
  }

  if (gitleaksGit || gitleaksDir || runByName.has("gitleaks (Docker Compose)")) {
    const gitLeaks = Array.isArray(gitleaksGit) ? gitleaksGit.length : "?";
    const dirLeaks = Array.isArray(gitleaksDir) ? gitleaksDir.length : "?";
    lines.push(`| \`gitleaks\` | ${scannerStatus("gitleaks (Docker Compose)", Boolean(gitleaksGit && gitleaksDir))} | git : ${gitLeaks} fuite(s), répertoire : ${dirLeaks} fuite(s) |`);
  }

  if (semgrep || runByName.has("semgrep (Docker Compose)")) {
    const findingsCount = Array.isArray(semgrep?.results) ? semgrep.results.length : "?";
    const filesCount = Array.isArray(semgrep?.paths?.scanned) ? semgrep.paths.scanned.length : "?";
    lines.push(`| \`semgrep\` | ${scannerStatus("semgrep (Docker Compose)", Boolean(semgrep))} | ${findingsCount} alerte(s) sur ${filesCount} fichiers |`);
  }

  if (trivyImage || runByName.has("trivy-image (Docker Compose)")) {
    const detail = trivyImage
      ? `${trivyImage.vulnBySeverity?.CRITICAL || 0} critical, ${trivyImage.vulnBySeverity?.HIGH || 0} high, ${trivyImage.secrets.length} secret(s)`
      : "—";
    lines.push(`| \`trivy-image\` | ${scannerStatus("trivy-image (Docker Compose)", Boolean(trivyImage))} | ${detail} |`);
  }

  if (trivySbom && trivySbom.vulnerabilities.length > 0) {
    lines.push(
      "",
      "## 3. Vulnérabilités sur le SBOM Maven transitif (`provided` / `test`)",
      "",
      "> Note : l’archive ZIP distribuée du plugin n’embarque aucun JAR tiers ; ces dépendances proviennent des dépendances `provided` (OIE / HAPI FHIR) ou `test`.",
      "",
      "| Librairie | CVE | Sévérité | Version installée | Correctif |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const v of trivySbom.vulnerabilities) {
      lines.push(
        `| \`${escapeMdCell(v.PkgName)}\` | \`${escapeMdCell(v.VulnerabilityID)}\` | ${escapeMdCell(v.Severity)} | \`${escapeMdCell(v.InstalledVersion)}\` | \`${escapeMdCell(v.FixedVersion || "—")}\` |`,
      );
    }
  }

  const extraVulns = [
    ...(trivyFs?.vulnerabilities || []).map((v) => ({ source: "trivy-fs", ...v })),
    ...(trivyPkg?.vulnerabilities || []).map((v) => ({ source: "trivy-package", ...v })),
    ...(trivyImage?.vulnerabilities || []).map((v) => ({ source: "trivy-image", ...v })),
  ];
  if (extraVulns.length > 0) {
    lines.push(
      "",
      "## 4. Autres vulnérabilités Trivy",
      "",
      "| Source | Cible | Librairie | CVE | Sévérité | Correctif |",
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const v of extraVulns) {
      lines.push(
        `| \`${v.source}\` | \`${escapeMdCell(v.target)}\` | \`${escapeMdCell(v.PkgName)}\` | \`${escapeMdCell(v.VulnerabilityID)}\` | ${escapeMdCell(v.Severity)} | \`${escapeMdCell(v.FixedVersion || "—")}\` |`,
      );
    }
  }

  const misconfigs = [
    ...(trivyFs?.misconfigurations || []),
    ...(trivyImage?.misconfigurations || []),
  ];
  if (misconfigs.length > 0) {
    lines.push("", "## Mauvaises configurations (Trivy)", "");
    for (const m of misconfigs) {
      lines.push(`- \`${m.target}\` [\`${m.ID || m.AVDID}\` ${m.Severity}] ${m.Title}`);
    }
  }

  if (Array.isArray(semgrep?.results) && semgrep.results.length > 0) {
    lines.push("", "## Alertes Semgrep", "");
    for (const r of semgrep.results) {
      lines.push(`- \`${r.path}:${r.start?.line || 0}\` [\`${r.check_id}\`] ${r.extra?.message || ""}`);
    }
  }

  const leaks = [
    ...(Array.isArray(gitleaksGit) ? gitleaksGit.map((l) => ({ scope: "git", ...l })) : []),
    ...(Array.isArray(gitleaksDir) ? gitleaksDir.map((l) => ({ scope: "dir", ...l })) : []),
  ];
  if (leaks.length > 0) {
    lines.push("", "## Fuites potentielles (Gitleaks)", "");
    for (const l of leaks) {
      lines.push(`- [${l.scope}] \`${l.File}:${l.StartLine || 0}\` (\`${l.RuleID}\`)`);
    }
  }

  const reportFiles = existsSync(outDir)
    ? readdirSync(outDir).filter((name) => name.endsWith(".json")).sort()
    : [];
  if (reportFiles.length > 0) {
    lines.push("", "## Rapports JSON détaillés", "");
    for (const name of reportFiles) {
      lines.push(`- \`${name}\``);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function runScanners(args) {
  const outDir = join(ROOT, "tools/security/reports");
  mkdirSync(outDir, { recursive: true });
  const composeFile = join(ROOT, "tools/security/compose.yaml");
  const all = args.includes("--scanners") || args.includes("--all");
  const runTrivy = all || args.includes("--trivy");
  const runSbom = all || args.includes("--sbom");
  const runGitleaks = all || args.includes("--gitleaks");
  const runSemgrep = all || args.includes("--semgrep");
  const runImage = args.includes("--image");
  const runNpmAudit = all || args.includes("--npm-audit");

  const results = [];
  const run = (label, fn) => {
    console.log(`\n==> Running ${label}...`);
    try {
      fn();
      results.push({ name: label, ok: true });
    } catch (error) {
      results.push({ name: label, ok: false, status: error.status ?? 1 });
    }
  };

  if (runNpmAudit) {
    run("npm audit (--audit-level=high)", () => {
      const jsonOut = execFileSync("npm", ["--prefix", "webadmin", "audit", "--audit-level=high", "--json"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      writeFileSync(join(outDir, "npm-audit.json"), jsonOut);
    });
  }
  if (runTrivy) {
    run("trivy-fs (Docker Compose)", () => {
      runCommand("docker", ["compose", "-f", composeFile, "run", "--rm", "trivy-fs"]);
    });
  }
  if (runSbom) {
    run("maven-sbom (CycloneDX + Trivy)", () => {
      runCommand("mvn", [
        "cyclonedx:makeAggregateBom",
        "-q",
        "-DoutputFormat=json",
        "-DoutputDirectory=tools/security/reports",
        "-DoutputName=maven-sbom",
        "-DincludeCompileScope=true",
        "-DincludeRuntimeScope=true",
        "-DincludeProvidedScope=true",
        "-DincludeTestScope=true",
      ]);
      runCommand("docker", ["compose", "-f", composeFile, "run", "--rm", "trivy-sbom"]);
      const trivySbom = collectTrivySummary(readJsonIfExists(join(outDir, "trivy-maven-sbom.json")));
      const critical = trivySbom?.vulnBySeverity?.CRITICAL || 0;
      if (critical > 0) {
        const err = new Error(`Critical vulnerabilities detected in Maven SBOM: ${critical}`);
        err.status = 1;
        throw err;
      }
    });
  }
  if (runGitleaks) {
    run("gitleaks (Docker Compose)", () => {
      runCommand("docker", ["compose", "-f", composeFile, "run", "--rm", "gitleaks"]);
    });
  }
  if (runSemgrep) {
    run("semgrep (Docker Compose)", () => {
      runCommand("docker", ["compose", "-f", composeFile, "run", "--rm", "semgrep"]);
    });
  }
  if (runImage) {
    run("trivy-image (Docker Compose)", () => {
      runCommand("docker", ["compose", "-f", composeFile, "run", "--rm", "trivy-image"]);
    });
  }

  return results;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log([
      "Usage: node tools/check_security.mjs [options]",
      "",
      "Offline static checks always run first (RBAC, XXE, Java/JS sinks, SHA-256).",
      "Options:",
      "  --scanners     Run npm audit + Trivy (fs & Maven SBOM), Gitleaks and Semgrep",
      "  --trivy        Run Trivy filesystem/config/secret scan via Docker Compose",
      "  --sbom         Generate Maven CycloneDX SBOM and scan it (+ packaged ZIP) with Trivy",
      "  --gitleaks     Run Gitleaks git + working tree secret scan via Docker Compose",
      "  --semgrep      Run Semgrep SAST via Docker Compose",
      "  --image        Run Trivy on local fhir-mapper-demo-oie:4.7.0 Docker image",
      "  --npm-audit    Run npm audit --audit-level=high in webadmin/",
      "  --summary      Write readable Markdown summary to tools/security/reports/summary.md",
      "  --json         Print JSON report for offline checks",
    ].join("\n"));
    process.exit(0);
  }

  const offline = checkSecurity(ROOT);
  if (args.includes("--json")) {
    console.log(JSON.stringify(offline, null, 2));
  } else {
    for (const c of offline.checks) {
      const status = c.findings.length === 0 ? "OK" : "FAIL";
      console.log(`${status} ${c.name} (${c.checked} checked)`);
    }
    for (const f of offline.findings) {
      console.error(`ERROR ${f.file}:${f.line} [${f.rule}] ${f.message}`);
    }
  }

  const wantScanners = ["--scanners", "--all", "--trivy", "--sbom", "--gitleaks", "--semgrep", "--image", "--npm-audit"]
    .some((flag) => args.includes(flag));
  const wantSummary = wantScanners || args.includes("--summary");
  const scannerResults = wantScanners ? runScanners(args) : [];
  const scannersOk = scannerResults.every((r) => r.ok);

  if (wantSummary) {
    const outDir = join(ROOT, "tools/security/reports");
    mkdirSync(outDir, { recursive: true });
    const summaryPath = join(outDir, "summary.md");
    writeFileSync(summaryPath, buildSecuritySummaryMarkdown({ offline, scanners: scannerResults, outDir }));
    if (scannerResults.length > 0) {
      console.log("\nSecurity scanner summary (reports in tools/security/reports/):");
      for (const r of scannerResults) {
        console.log(`- ${r.name}: ${r.ok ? "OK" : `FAILED (exit ${r.status})`}`);
      }
    }
    console.log(`Summary report written to ${relative(ROOT, summaryPath)}`);
  }

  if (!offline.ok || !scannersOk) {
    process.exit(1);
  }
}
