import {
  MappingInput,
  MappingOutput,
  MappedTestCase,
  MappedStep,
  ParsedStep,
  ExplorerOutput,
  DiscoveredElement,
  LocatorStrategy,
} from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("mapping-agent");

export class MappingAgent {
  async execute(input: MappingInput): Promise<MappingOutput> {
    const timer = logger.startTimer();
    logger.info("Starting step-to-locator mapping", {
      testCases: input.parsedTests.testCases.length,
      uiElements: input.uiMap.totalElements,
    });

    const testCases: MappedTestCase[] = [];
    const allUnmapped: string[] = [];
    const warnings: string[] = [];

    for (const tc of input.parsedTests.testCases) {
      const mapped = this.mapTestCase(tc.name, tc.steps, input.uiMap, warnings);
      testCases.push(mapped);

      const unmapped = mapped.steps
        .filter((s) => s.needsReview)
        .map((s) => `${tc.name}:${s.original.action}:${s.original.selector ?? "no-selector"}`);
      allUnmapped.push(...unmapped);
    }

    const totalConfidence =
      testCases.length > 0
        ? Math.round(testCases.reduce((s, tc) => s + tc.confidence, 0) / testCases.length)
        : 0;

    const output: MappingOutput = {
      testCases,
      overallConfidence: totalConfidence,
      unmappedElements: allUnmapped,
      warnings,
    };

    logger.info("Mapping complete", {
      testCases: testCases.length,
      overallConfidence: totalConfidence,
      unmapped: allUnmapped.length,
      duration: `${timer()}ms`,
    });

    return output;
  }

  private mapTestCase(
    name: string,
    steps: ParsedStep[],
    uiMap: ExplorerOutput,
    warnings: string[]
  ): MappedTestCase {
    const mappedSteps: MappedStep[] = [];
    const pageObjectsUsed = new Set<string>();
    let unmappedCount = 0;

    for (const step of steps) {
      const mapped = this.mapStep(step, uiMap);
      mappedSteps.push(mapped);

      if (mapped.needsReview) unmappedCount++;

      if (step.target) pageObjectsUsed.add(step.target);
    }

    const confidence =
      steps.length > 0
        ? Math.round(
            mappedSteps.reduce((s, ms) => s + ms.confidence, 0) / steps.length
          )
        : 100;

    return {
      name,
      steps: mappedSteps,
      pageObjectsUsed: [...pageObjectsUsed],
      confidence,
      unmappedSteps: unmappedCount,
    };
  }

  private mapStep(step: ParsedStep, uiMap: ExplorerOutput): MappedStep {
    // Try to find matching UI element
    const match = this.findBestMatch(step, uiMap);

    if (match) {
      return {
        original: step,
        playwrightAction: this.toPlaywrightAction(step, match.locator),
        locator: match.locator,
        locatorStrategy: match.locatorStrategy,
        confidence: match.confidence,
        needsReview: match.confidence < 70,
        reviewReason: match.confidence < 70 ? "Low confidence match" : undefined,
      };
    }

    // Fall back to converting Provar selector directly
    const fallback = this.convertProvarSelector(step);
    return {
      original: step,
      playwrightAction: this.toPlaywrightAction(step, fallback.locator),
      locator: fallback.locator,
      locatorStrategy: fallback.strategy,
      confidence: fallback.confidence,
      needsReview: true,
      reviewReason: "No UI map match — using converted Provar selector",
    };
  }

  private findBestMatch(
    step: ParsedStep,
    uiMap: ExplorerOutput
  ): { locator: string; locatorStrategy: LocatorStrategy; confidence: number } | null {
    if (!step.selector && !step.target) return null;

    let bestMatch: DiscoveredElement | null = null;
    let bestScore = 0;

    const allElements = uiMap.pages.flatMap((p) => p.elements);

    for (const el of allElements) {
      const score = this.calculateMatchScore(step, el);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = el;
      }
    }

    if (bestMatch && bestScore > 30) {
      return {
        locator: bestMatch.locator,
        locatorStrategy: bestMatch.locatorStrategy,
        confidence: Math.min(100, bestScore),
      };
    }

    return null;
  }

  private calculateMatchScore(step: ParsedStep, element: DiscoveredElement): number {
    let score = 0;
    const selector = step.selector?.toLowerCase() ?? "";
    const target = step.target?.toLowerCase() ?? "";

    // Direct name match
    if (element.name && selector.includes(element.name.toLowerCase())) score += 60;
    if (element.name && target.includes(element.name.toLowerCase())) score += 50;

    // Label match
    if (element.label && selector.includes(element.label.toLowerCase())) score += 55;

    // Test ID match
    if (element.testId && selector.includes(element.testId.toLowerCase())) score += 70;

    // Role-based matching for action types
    if (step.action === "click" && element.role === "button") score += 20;
    if (step.action === "type" && element.role === "textbox") score += 20;
    if (step.action === "select" && element.role === "combobox") score += 20;

    // ID fragment match
    if (element.name) {
      const nameWords = element.name.toLowerCase().split(/[\s_-]+/);
      const selectorWords = selector.split(/[\s_\-./\[\]()]+/);
      const matches = nameWords.filter((w) => selectorWords.includes(w));
      score += matches.length * 15;
    }

    // Prefer role-based locators
    if (element.locatorStrategy === "getByRole") score += 10;
    if (element.locatorStrategy === "getByLabel") score += 8;
    if (element.locatorStrategy === "getByTestId") score += 6;

    return score;
  }

  private convertProvarSelector(
    step: ParsedStep
  ): { locator: string; strategy: LocatorStrategy; confidence: number } {
    const sel = step.selector ?? "";

    // XPath → try to extract meaningful parts
    if (step.selectorType === "xpath" || sel.startsWith("//")) {
      const idMatch = sel.match(/@id=['"]([^'"]+)['"]/);
      if (idMatch) {
        return { locator: `#${idMatch[1]}`, strategy: "css", confidence: 50 };
      }

      const nameMatch = sel.match(/@name=['"]([^'"]+)['"]/);
      if (nameMatch) {
        return {
          locator: `getByRole('textbox', { name: '${nameMatch[1]}' })`,
          strategy: "getByRole",
          confidence: 40,
        };
      }

      // Last resort: keep XPath but flag
      return { locator: sel, strategy: "xpath", confidence: 20 };
    }

    // CSS selector
    if (sel.startsWith("#") || sel.startsWith(".") || sel.includes("[")) {
      return { locator: sel, strategy: "css", confidence: 45 };
    }

    // Simple name/ID
    if (sel) {
      return { locator: `#${sel}`, strategy: "css", confidence: 35 };
    }

    return { locator: "/* TODO: manual mapping required */", strategy: "css", confidence: 0 };
  }

  private toPlaywrightAction(step: ParsedStep, locator: string): string {
    const loc = locator.startsWith("getBy")
      ? `page.${locator}`
      : `page.locator('${locator.replace(/'/g, "\\'")}')`;

    switch (step.action) {
      case "click":
        return `await ${loc}.click();`;
      case "type":
        return `await ${loc}.fill('${(step.value ?? "").replace(/'/g, "\\'")}');`;
      case "select":
        return `await ${loc}.selectOption('${(step.value ?? "").replace(/'/g, "\\'")}');`;
      case "assert":
        return this.generateAssertion(loc, step);
      case "navigate":
        return `await page.goto('${step.value ?? step.target ?? ""}');`;
      case "hover":
        return `await ${loc}.hover();`;
      case "wait":
        return `await ${loc}.waitFor();`;
      case "iframe-switch":
        return `const frame = page.frameLocator('${locator}');`;
      case "screenshot":
        return `await page.screenshot({ path: 'screenshots/${step.target ?? "screenshot"}.png' });`;
      case "scroll":
        return `await ${loc}.scrollIntoViewIfNeeded();`;
      default:
        return `// TODO: implement ${step.action}`;
    }
  }

  private generateAssertion(locator: string, step: ParsedStep): string {
    const assertion = step.assertion;
    if (!assertion) {
      return `await expect(${locator}).toBeVisible();`;
    }

    const expected = assertion.expected.replace(/'/g, "\\'");

    switch (assertion.type) {
      case "visible":
        return `await expect(${locator}).toBeVisible();`;
      case "text":
        return assertion.operator === "contains"
          ? `await expect(${locator}).toContainText('${expected}');`
          : `await expect(${locator}).toHaveText('${expected}');`;
      case "value":
        return `await expect(${locator}).toHaveValue('${expected}');`;
      case "enabled":
        return `await expect(${locator}).toBeEnabled();`;
      case "url":
        return `await expect(page).toHaveURL('${expected}');`;
      case "title":
        return `await expect(page).toHaveTitle('${expected}');`;
      default:
        return `await expect(${locator}).toBeVisible();`;
    }
  }
}

export async function runMappingAgent(input: MappingInput): Promise<MappingOutput> {
  const agent = new MappingAgent();
  return agent.execute(input);
}
