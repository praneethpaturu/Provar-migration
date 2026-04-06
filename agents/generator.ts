import * as fs from "fs";
import * as path from "path";
import {
  GeneratorInput,
  GeneratorOutput,
  GeneratedTest,
  GeneratedPageObject,
  MappedTestCase,
  PlannerOutput,
  PageObjectSuggestion,
} from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("generator-agent");

export class GeneratorAgent {
  async execute(input: GeneratorInput): Promise<GeneratorOutput> {
    const timer = logger.startTimer();
    logger.info("Generating Playwright tests", {
      testCases: input.mappedTests.testCases.length,
    });

    const outputDir = input.outputDir;
    const testsDir = path.join(outputDir, "tests");
    const pagesDir = path.join(outputDir, "pages");

    fs.mkdirSync(testsDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true });

    // Generate Page Objects first
    const pageObjects = this.generatePageObjects(
      input.plannerOutput.pageObjectSuggestions,
      input.mappedTests.testCases,
      pagesDir
    );

    // Generate test files
    const tests: GeneratedTest[] = [];
    for (const tc of input.mappedTests.testCases) {
      const test = this.generateTest(tc, input.plannerOutput, testsDir, pageObjects);
      tests.push(test);
    }

    // Generate Playwright config
    this.generatePlaywrightConfig(outputDir, input.plannerOutput);

    const output: GeneratorOutput = {
      tests,
      pageObjects,
      totalFiles: tests.length + pageObjects.length + 1, // +1 for config
      warnings: [],
    };

    logger.info("Generation complete", {
      testFiles: tests.length,
      pageObjectFiles: pageObjects.length,
      duration: `${timer()}ms`,
    });

    return output;
  }

  private generateTest(
    testCase: MappedTestCase,
    plannerOutput: PlannerOutput,
    testsDir: string,
    pageObjects: GeneratedPageObject[]
  ): GeneratedTest {
    const fileName = `${this.toKebabCase(testCase.name)}.spec.ts`;
    const filePath = path.join(testsDir, fileName);

    const imports = this.buildImports(testCase, pageObjects);
    const testBody = this.buildTestBody(testCase, plannerOutput);

    const code = `${imports}

import { test, expect } from '@playwright/test';

test.describe('${this.escapeString(testCase.name)}', () => {
${testBody}
});
`;

    fs.writeFileSync(filePath, code);
    logger.info(`Generated test: ${fileName}`);

    return {
      fileName,
      filePath,
      code,
      testCount: 1,
      pageObjectsGenerated: testCase.pageObjectsUsed,
    };
  }

  private buildImports(
    testCase: MappedTestCase,
    pageObjects: GeneratedPageObject[]
  ): string {
    const imports: string[] = [];

    for (const poName of testCase.pageObjectsUsed) {
      const po = pageObjects.find((p) => p.pageName === poName);
      if (po) {
        const className = this.toPascalCase(poName) + "Page";
        const relPath = path.relative(
          path.dirname("tests/placeholder"),
          po.filePath
        ).replace(/\.ts$/, "");
        imports.push(`import { ${className} } from '${relPath}';`);
      }
    }

    return imports.join("\n");
  }

  private buildTestBody(testCase: MappedTestCase, plannerOutput: PlannerOutput): string {
    const lines: string[] = [];
    const indent = "  ";

    // Add login setup if detected as reusable flow
    const hasLogin = plannerOutput.reusableFlows.some((f) => f.name === "login");

    if (hasLogin) {
      lines.push(`${indent}test.beforeEach(async ({ page }) => {`);
      lines.push(`${indent}${indent}// Login flow — extracted as reusable setup`);
      lines.push(`${indent}${indent}await page.goto(process.env.BASE_URL ?? '/');`);
      lines.push(`${indent}${indent}await page.getByLabel('Username').fill(process.env.SF_USERNAME ?? '');`);
      lines.push(`${indent}${indent}await page.getByLabel('Password').fill(process.env.SF_PASSWORD ?? '');`);
      lines.push(`${indent}${indent}await page.getByRole('button', { name: 'Log In' }).click();`);
      lines.push(`${indent}${indent}await page.waitForLoadState('networkidle');`);
      lines.push(`${indent}});`);
      lines.push("");
    }

    lines.push(`${indent}test('${this.escapeString(testCase.name)}', async ({ page }) => {`);

    for (const step of testCase.steps) {
      if (step.needsReview) {
        lines.push(
          `${indent}${indent}// ⚠️ REVIEW: ${step.reviewReason ?? "needs manual verification"}`
        );
      }
      lines.push(`${indent}${indent}${step.playwrightAction}`);
    }

    lines.push(`${indent}});`);

    return lines.join("\n");
  }

  private generatePageObjects(
    suggestions: PageObjectSuggestion[],
    testCases: MappedTestCase[],
    pagesDir: string
  ): GeneratedPageObject[] {
    const pageObjects: GeneratedPageObject[] = [];

    for (const suggestion of suggestions) {
      const className = this.toPascalCase(suggestion.pageName) + "Page";
      const fileName = suggestion.suggestedFileName;
      const filePath = path.join(pagesDir, fileName);

      const code = this.buildPageObjectCode(className, suggestion);

      fs.writeFileSync(filePath, code);
      logger.info(`Generated page object: ${fileName}`);

      pageObjects.push({
        fileName,
        filePath,
        code,
        pageName: suggestion.pageName,
      });
    }

    return pageObjects;
  }

  private buildPageObjectCode(
    className: string,
    suggestion: PageObjectSuggestion
  ): string {
    const elements = suggestion.elements;
    const indent = "  ";

    const locatorDeclarations = elements
      .map((el) => {
        const propName = this.toCamelCase(el);
        return `${indent}get ${propName}() {\n${indent}${indent}return this.page.getByLabel('${this.escapeString(el)}');\n${indent}}`;
      })
      .join("\n\n");

    return `import { type Page, type Locator } from '@playwright/test';

export class ${className} {
${indent}readonly page: Page;

${indent}constructor(page: Page) {
${indent}${indent}this.page = page;
${indent}}

${locatorDeclarations}

${indent}async navigate() {
${indent}${indent}// TODO: set correct URL for ${suggestion.pageName}
${indent}${indent}await this.page.goto('/');
${indent}}
}
`;
  }

  private generatePlaywrightConfig(outputDir: string, plannerOutput: PlannerOutput): void {
    const isSalesforce = plannerOutput.recommendations.some((r) =>
      r.includes("Salesforce")
    );

    const config = `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://login.salesforce.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: ${isSalesforce ? 15000 : 10000},
    navigationTimeout: ${isSalesforce ? 30000 : 15000},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
`;

    const filePath = path.join(outputDir, "playwright.config.ts");
    fs.writeFileSync(filePath, config);
    logger.info("Generated playwright.config.ts");
  }

  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase();
  }

  private toPascalCase(str: string): string {
    return str
      .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
      .replace(/^(.)/, (c) => c.toUpperCase());
  }

  private toCamelCase(str: string): string {
    const pascal = this.toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
  }

  private escapeString(str: string): string {
    return str.replace(/'/g, "\\'").replace(/\n/g, "\\n");
  }
}

export async function runGeneratorAgent(input: GeneratorInput): Promise<GeneratorOutput> {
  const agent = new GeneratorAgent();
  return agent.execute(input);
}
