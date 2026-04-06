import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger";

const logger = createLogger("provar-reader");

/**
 * Understands the standard Provar project layout:
 *
 *   Oliva/
 *   ├── .licenses/
 *   ├── .settings/
 *   ├── .smtp/
 *   ├── ANT/                 ← build scripts
 *   ├── bin/
 *   ├── META-INF/
 *   │   └── MANIFEST.MF
 *   ├── src/
 *   │   └── pageobjects/    ← Provar Page Object definitions
 *   ├── templates/           ← test templates
 *   ├── tests/               ← Provar test cases (XML)
 *   ├── .classpath
 *   ├── .gitignore
 *   ├── .project
 *   ├── .secrets/            ← credentials / connection configs
 *   ├── .testproject
 *   ├── build.properties
 *   └── nitroXConfig.json    ← NitroX configuration
 */

export interface ProvarProject {
  rootDir: string;
  testsDir: string;
  pageObjectsDir: string;
  templatesDir: string;
  secretsDir: string;
  antDir: string;
  nitroXConfig: string;
  buildProperties: string;
}

export function resolveProvarProject(rootDir: string): ProvarProject {
  return {
    rootDir,
    testsDir: path.join(rootDir, "tests"),
    pageObjectsDir: path.join(rootDir, "src", "pageobjects"),
    templatesDir: path.join(rootDir, "templates"),
    secretsDir: path.join(rootDir, ".secrets"),
    antDir: path.join(rootDir, "ANT"),
    nitroXConfig: path.join(rootDir, "nitroXConfig.json"),
    buildProperties: path.join(rootDir, "build.properties"),
  };
}

export function listTestFiles(project: ProvarProject): string[] {
  return findFilesRecursive(project.testsDir, ".testcase");
}

export function listPageObjectFiles(project: ProvarProject): string[] {
  return findFilesRecursive(project.pageObjectsDir, ".page");
}

export function listTemplateFiles(project: ProvarProject): string[] {
  return findFilesRecursive(project.templatesDir, ".testcase");
}

export function readNitroXConfig(project: ProvarProject): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(project.nitroXConfig, "utf-8");
    return JSON.parse(raw);
  } catch {
    logger.warn("Could not read nitroXConfig.json");
    return null;
  }
}

function findFilesRecursive(dir: string, ext: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    logger.warn(`Directory not found: ${dir}`);
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(fullPath, ext));
    } else if (entry.name.endsWith(ext) || entry.name.endsWith(".xml")) {
      results.push(fullPath);
    }
  }

  return results;
}
