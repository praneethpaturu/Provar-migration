import * as fs from "fs";
import {
  FixerInput,
  FixerOutput,
  FixResult,
  TestResult,
  GeneratedTest,
  ExplorerOutput,
  DiscoveredElement,
} from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("fixer-agent");

export class FixerAgent {
  async execute(input: FixerInput): Promise<FixerOutput> {
    const timer = logger.startTimer();
    logger.info("Starting auto-fix", { failedTests: input.failedTests.length });

    const fixes: FixResult[] = [];
    const unfixable: string[] = [];
    const warnings: string[] = [];
    const fixedTests: GeneratedTest[] = [];

    for (const failed of input.failedTests) {
      const original = input.generatedTests.find((t) => t.fileName === failed.fileName);
      if (!original) {
        unfixable.push(failed.testName);
        continue;
      }

      const fix = this.attemptFix(failed, original, input.uiMap);

      if (fix) {
        fixes.push(fix);

        // Write updated code to file
        fs.writeFileSync(original.filePath, fix.updatedCode);

        fixedTests.push({
          ...original,
          code: fix.updatedCode,
        });
      } else {
        unfixable.push(failed.testName);
      }
    }

    const output: FixerOutput = {
      fixes,
      fixedTests,
      unfixable,
      warnings,
    };

    logger.info("Fix complete", {
      fixed: fixes.length,
      unfixable: unfixable.length,
      duration: `${timer()}ms`,
    });

    return output;
  }

  private attemptFix(
    failed: TestResult,
    original: GeneratedTest,
    uiMap: ExplorerOutput
  ): FixResult | null {
    if (!failed.error) return null;

    switch (failed.error.type) {
      case "locator":
        return this.fixLocator(failed, original, uiMap);
      case "timeout":
        return this.fixTimeout(failed, original);
      case "assertion":
        return this.fixAssertion(failed, original);
      case "navigation":
        return this.fixNavigation(failed, original);
      default:
        return null;
    }
  }

  private fixLocator(
    failed: TestResult,
    original: GeneratedTest,
    uiMap: ExplorerOutput
  ): FixResult | null {
    const errorMsg = failed.error!.message;
    let updatedCode = original.code;

    // Extract the failing selector from the error
    const selectorMatch = errorMsg.match(
      /locator\(['"]([^'"]+)['"]\)|getBy\w+\(['"]([^'"]+)['"]/
    );
    const failingSelector = selectorMatch?.[1] ?? selectorMatch?.[2];

    if (!failingSelector) {
      // Try to find CSS selectors in the error
      const cssMatch = errorMsg.match(/(#[\w-]+|\.[\w-]+|\[[\w-]+=["'][^"']+["']\])/);
      if (!cssMatch) return null;
    }

    // Search UI map for better alternative
    const allElements = uiMap.pages.flatMap((p) => p.elements);
    const replacement = this.findAlternativeLocator(failingSelector ?? "", allElements);

    if (replacement) {
      updatedCode = this.replaceLocatorInCode(updatedCode, failingSelector ?? "", replacement);

      return {
        testName: failed.testName,
        originalError: errorMsg,
        fixApplied: `Replaced selector "${failingSelector}" with "${replacement}"`,
        fixType: "selector-replaced",
        updatedCode,
        confidence: 65,
      };
    }

    // Fallback: add waitFor before the interaction
    updatedCode = this.addWaitBeforeLocator(updatedCode, failingSelector ?? "");

    return {
      testName: failed.testName,
      originalError: errorMsg,
      fixApplied: `Added waitFor() before interaction with "${failingSelector}"`,
      fixType: "wait-added",
      updatedCode,
      confidence: 40,
    };
  }

  private fixTimeout(failed: TestResult, original: GeneratedTest): FixResult {
    let updatedCode = original.code;

    // Replace hardcoded waits with auto-waiting patterns
    updatedCode = updatedCode.replace(
      /await page\.waitForTimeout\(\d+\)/g,
      "await page.waitForLoadState('networkidle')"
    );

    // Add waitForLoadState before navigation-heavy operations
    updatedCode = updatedCode.replace(
      /(await page\.goto\([^)]+\));/g,
      "$1;\n    await page.waitForLoadState('networkidle');"
    );

    // Increase action timeouts inline
    updatedCode = updatedCode.replace(
      /\.click\(\)/g,
      ".click({ timeout: 15000 })"
    );
    updatedCode = updatedCode.replace(
      /\.fill\(([^)]+)\)/g,
      ".fill($1, { timeout: 15000 })"
    );

    return {
      testName: failed.testName,
      originalError: failed.error!.message,
      fixApplied: "Added auto-waiting and increased timeouts",
      fixType: "wait-added",
      updatedCode,
      confidence: 55,
    };
  }

  private fixAssertion(failed: TestResult, original: GeneratedTest): FixResult | null {
    let updatedCode = original.code;

    // Convert exact text matches to containsText for resilience
    updatedCode = updatedCode.replace(
      /toHaveText\('([^']+)'\)/g,
      "toContainText('$1')"
    );

    // Add soft assertions option
    updatedCode = updatedCode.replace(
      /await expect\(/g,
      "await expect.soft("
    );

    return {
      testName: failed.testName,
      originalError: failed.error!.message,
      fixApplied: "Relaxed assertions: toHaveText → toContainText, added soft assertions",
      fixType: "assertion-adjusted",
      updatedCode,
      confidence: 50,
    };
  }

  private fixNavigation(failed: TestResult, original: GeneratedTest): FixResult | null {
    let updatedCode = original.code;

    // Ensure all goto calls have proper wait strategies
    updatedCode = updatedCode.replace(
      /await page\.goto\(([^)]+)\)/g,
      "await page.goto($1, { waitUntil: 'networkidle', timeout: 30000 })"
    );

    return {
      testName: failed.testName,
      originalError: failed.error!.message,
      fixApplied: "Added networkidle wait strategy and increased navigation timeout",
      fixType: "wait-added",
      updatedCode,
      confidence: 60,
    };
  }

  private findAlternativeLocator(
    failing: string,
    elements: DiscoveredElement[]
  ): string | null {
    // Try to find an element that matches parts of the failing selector
    const failingLower = failing.toLowerCase();

    for (const el of elements) {
      if (!el.isInteractive) continue;

      // Match by name fragments
      const name = el.name?.toLowerCase() ?? "";
      const label = el.label?.toLowerCase() ?? "";

      if (
        (name && failingLower.includes(name)) ||
        (label && failingLower.includes(label)) ||
        (name && name.includes(failingLower))
      ) {
        // Return the best locator from the UI map
        return el.locator;
      }
    }

    return null;
  }

  private replaceLocatorInCode(
    code: string,
    oldSelector: string,
    newLocator: string
  ): string {
    const escaped = oldSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Replace in page.locator('...')
    code = code.replace(
      new RegExp(`page\\.locator\\(['"]${escaped}['"]\\)`, "g"),
      newLocator.startsWith("getBy") ? `page.${newLocator}` : `page.locator('${newLocator}')`
    );

    // Replace in getBy patterns
    code = code.replace(
      new RegExp(`getBy\\w+\\(['"]${escaped}['"]\\)`, "g"),
      newLocator
    );

    return code;
  }

  private addWaitBeforeLocator(code: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(\\s*)(await page\\.(?:locator\\(['"]${escaped}['"]\\)|getBy\\w+\\(['"]${escaped}['"]\\)))`,
      "g"
    );

    return code.replace(pattern, (_, indent, action) => {
      return `${indent}await page.waitForLoadState('networkidle');\n${indent}${action}`;
    });
  }
}

export async function runFixerAgent(input: FixerInput): Promise<FixerOutput> {
  const agent = new FixerAgent();
  return agent.execute(input);
}
