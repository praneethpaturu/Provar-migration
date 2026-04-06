import { XMLParser } from "fast-xml-parser";
import * as fs from "fs";
import {
  PlannerInput,
  PlannerOutput,
  TestComplexity,
  ReusableFlow,
  PageObjectSuggestion,
  MigrationStrategy,
  TelemetryReport,
} from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("planner-agent");

export class PlannerAgent {
  private xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: true,
    });
  }

  async execute(input: PlannerInput): Promise<PlannerOutput> {
    const timer = logger.startTimer();
    logger.info("Starting migration planning", { appType: input.metadata.appType });

    const xmlContent = fs.readFileSync(input.provarXml, "utf-8");
    const parsed = this.xmlParser.parse(xmlContent);

    const complexity = this.classifyComplexity(parsed);
    const strategy = this.decideStrategy(complexity, input.metadata, input.historicalTelemetry);
    const reusableFlows = this.identifyReusableFlows(parsed);
    const pageObjectSuggestions = this.suggestPageObjects(parsed);
    const risks = this.identifyRisks(parsed, input.metadata);
    const recommendations = this.generateRecommendations(strategy, risks, input.metadata);
    const priority = this.determinePriority(parsed, reusableFlows);
    const automationDecision = this.decideAutomation(complexity, risks);

    const output: PlannerOutput = {
      strategy,
      priority,
      risks,
      recommendations,
      complexity,
      reusableFlows,
      pageObjectSuggestions,
      automationDecision,
    };

    logger.info("Planning complete", {
      strategy,
      complexity: complexity.overall,
      automationDecision,
      duration: `${timer()}ms`,
    });

    return output;
  }

  private classifyComplexity(parsed: Record<string, unknown>): TestComplexity {
    const steps = this.extractAllSteps(parsed);
    let uiInteractions = 0;
    let apiCalls = 0;
    let assertions = 0;
    let dynamicElements = 0;

    for (const step of steps) {
      const action = this.getStepAction(step);

      if (["click", "type", "select", "hover", "drag", "scroll"].includes(action)) {
        uiInteractions++;
      }
      if (action === "api-call" || action === "callMethod") {
        apiCalls++;
      }
      if (action === "assert" || action === "verify" || action === "validate") {
        assertions++;
      }

      const selector = this.getStepSelector(step);
      if (selector && (selector.includes("lightning-") || selector.includes("force-"))) {
        dynamicElements++;
      }
    }

    let overall: "low" | "medium" | "high" = "low";
    if (steps.length > 50 || dynamicElements > 10) overall = "high";
    else if (steps.length > 20 || dynamicElements > 3) overall = "medium";

    return {
      overall,
      totalSteps: steps.length,
      uiInteractions,
      apiCalls,
      assertions,
      dynamicElements,
    };
  }

  private decideStrategy(
    complexity: TestComplexity,
    metadata: PlannerInput["metadata"],
    history?: TelemetryReport
  ): MigrationStrategy {
    // Prefer API-based if most steps are API calls
    if (complexity.apiCalls > complexity.uiInteractions) {
      return "api-based";
    }

    // Use hybrid for Salesforce Lightning (complex DOM + API mix)
    if (metadata.appType === "salesforce" && metadata.lightningEnabled) {
      return "hybrid";
    }

    // If historical telemetry shows low success with UI, try hybrid
    if (history && history.successRate < 60) {
      return "hybrid";
    }

    return "ui-based";
  }

  private identifyReusableFlows(parsed: Record<string, unknown>): ReusableFlow[] {
    const flows: ReusableFlow[] = [];
    const stepSequences = this.extractStepSequences(parsed);
    const sequenceCounts = new Map<string, { steps: string[]; count: number }>();

    for (const seq of stepSequences) {
      const key = seq.join("|");
      const existing = sequenceCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        sequenceCounts.set(key, { steps: seq, count: 1 });
      }
    }

    // Login flow detection
    const loginSteps = this.detectLoginFlow(parsed);
    if (loginSteps.length > 0) {
      flows.push({ name: "login", steps: loginSteps, frequency: 0 });
    }

    // Navigation flow detection
    const navSteps = this.detectNavigationFlow(parsed);
    if (navSteps.length > 0) {
      flows.push({ name: "navigation", steps: navSteps, frequency: 0 });
    }

    // Repeated sequences (frequency >= 2)
    for (const [, value] of sequenceCounts) {
      if (value.count >= 2) {
        flows.push({
          name: `reusable-flow-${flows.length + 1}`,
          steps: value.steps,
          frequency: value.count,
        });
      }
    }

    return flows;
  }

  private suggestPageObjects(parsed: Record<string, unknown>): PageObjectSuggestion[] {
    const suggestions: PageObjectSuggestion[] = [];
    const pages = this.extractPageNames(parsed);

    for (const pageName of pages) {
      const elements = this.extractElementsForPage(parsed, pageName);
      suggestions.push({
        pageName,
        elements,
        suggestedFileName: `${this.toKebabCase(pageName)}.page.ts`,
      });
    }

    return suggestions;
  }

  private identifyRisks(parsed: Record<string, unknown>, metadata: PlannerInput["metadata"]): string[] {
    const risks: string[] = [];
    const steps = this.extractAllSteps(parsed);

    // Check for dynamic locators
    const hasXPath = steps.some((s) => {
      const sel = this.getStepSelector(s);
      return sel && (sel.startsWith("//") || sel.includes("xpath"));
    });
    if (hasXPath) risks.push("dynamic-locators: XPath selectors detected — fragile in Playwright");

    // Check for iframes (Salesforce Lightning uses them heavily)
    const hasIframes = steps.some((s) => {
      const action = this.getStepAction(s);
      return action === "iframe-switch" || action === "switchFrame";
    });
    if (hasIframes) risks.push("iframes: iframe switching detected — needs frameLocator() handling");

    // Salesforce-specific risks
    if (metadata.appType === "salesforce") {
      risks.push("salesforce-lightning: dynamic DOM with shadow DOM and Aura components");
      if (metadata.lightningEnabled) {
        risks.push("lightning-web-components: LWC shadow roots require special selectors");
      }
    }

    // Hardcoded waits
    const hasWaits = steps.some((s) => this.getStepAction(s) === "wait");
    if (hasWaits) risks.push("hardcoded-waits: explicit waits should be replaced with auto-waiting");

    // Complex assertions
    const complexAssertions = steps.filter(
      (s) => this.getStepAction(s) === "assert"
    ).length;
    if (complexAssertions > 20) {
      risks.push("high-assertion-count: many assertions may need manual review");
    }

    return risks;
  }

  private generateRecommendations(
    strategy: MigrationStrategy,
    risks: string[],
    metadata: PlannerInput["metadata"]
  ): string[] {
    const recs: string[] = [];

    recs.push("use data-testid attributes for stable selectors where possible");
    recs.push("prefer getByRole() and getByLabel() over CSS/XPath selectors");
    recs.push("leverage Playwright auto-waiting — avoid explicit sleep/wait calls");

    if (risks.some((r) => r.includes("xpath"))) {
      recs.push("replace XPath selectors with ARIA role-based locators");
    }

    if (risks.some((r) => r.includes("iframe"))) {
      recs.push("use page.frameLocator() for iframe content access");
    }

    if (metadata.appType === "salesforce") {
      recs.push("use Salesforce-specific locator patterns (lightning-input, etc.)");
      recs.push("handle Salesforce page load with networkidle wait strategy");
    }

    if (strategy === "hybrid") {
      recs.push("use API calls for data setup/teardown, UI for interaction tests");
    }

    return recs;
  }

  private determinePriority(parsed: Record<string, unknown>, flows: ReusableFlow[]): string[] {
    const priority: string[] = [];

    // Login is always first
    if (flows.some((f) => f.name === "login")) {
      priority.push("login");
    }

    priority.push("core-flows");
    priority.push("data-validation");
    priority.push("edge-cases");

    return priority;
  }

  private decideAutomation(
    complexity: TestComplexity,
    risks: string[]
  ): "full-automation" | "partial-manual-review" {
    if (complexity.overall === "high" || risks.length > 4) {
      return "partial-manual-review";
    }
    return "full-automation";
  }

  // ── XML traversal helpers ─────────────────────────────────

  private extractAllSteps(parsed: Record<string, unknown>): Record<string, unknown>[] {
    const steps: Record<string, unknown>[] = [];
    this.walkTree(parsed, (node) => {
      if (node && typeof node === "object" && ("@_action" in node || "@_type" in node || "action" in node)) {
        steps.push(node as Record<string, unknown>);
      }
    });
    return steps;
  }

  private extractStepSequences(parsed: Record<string, unknown>): string[][] {
    const sequences: string[][] = [];
    const steps = this.extractAllSteps(parsed);
    const windowSize = 3;

    for (let i = 0; i <= steps.length - windowSize; i++) {
      sequences.push(
        steps.slice(i, i + windowSize).map((s) => this.getStepAction(s))
      );
    }
    return sequences;
  }

  private detectLoginFlow(parsed: Record<string, unknown>): string[] {
    const steps = this.extractAllSteps(parsed);
    const loginSteps: string[] = [];

    for (const step of steps) {
      const selector = this.getStepSelector(step)?.toLowerCase() ?? "";
      const value = String(step["@_value"] ?? step["value"] ?? "").toLowerCase();

      if (
        selector.includes("username") ||
        selector.includes("password") ||
        selector.includes("login") ||
        value.includes("login")
      ) {
        loginSteps.push(this.getStepAction(step));
      }
    }

    return loginSteps;
  }

  private detectNavigationFlow(parsed: Record<string, unknown>): string[] {
    const steps = this.extractAllSteps(parsed);
    return steps
      .filter((s) => {
        const action = this.getStepAction(s);
        return action === "navigate" || action === "open" || action === "goto";
      })
      .map((s) => this.getStepAction(s));
  }

  private extractPageNames(parsed: Record<string, unknown>): string[] {
    const pages = new Set<string>();
    this.walkTree(parsed, (node) => {
      if (node && typeof node === "object") {
        const page = (node as Record<string, unknown>)["@_page"] ??
          (node as Record<string, unknown>)["page"] ??
          (node as Record<string, unknown>)["@_pageName"];
        if (typeof page === "string" && page.length > 0) {
          pages.add(page);
        }
      }
    });
    return [...pages];
  }

  private extractElementsForPage(parsed: Record<string, unknown>, pageName: string): string[] {
    const elements = new Set<string>();
    this.walkTree(parsed, (node) => {
      if (node && typeof node === "object") {
        const rec = node as Record<string, unknown>;
        const page = rec["@_page"] ?? rec["page"] ?? rec["@_pageName"];
        if (page === pageName) {
          const el = rec["@_field"] ?? rec["@_element"] ?? rec["@_name"];
          if (typeof el === "string") elements.add(el);
        }
      }
    });
    return [...elements];
  }

  private getStepAction(step: Record<string, unknown>): string {
    return String(step["@_action"] ?? step["action"] ?? step["@_type"] ?? "unknown");
  }

  private getStepSelector(step: Record<string, unknown>): string | null {
    const sel = step["@_selector"] ?? step["selector"] ?? step["@_locator"] ?? step["@_xpath"] ?? step["@_field"];
    return typeof sel === "string" ? sel : null;
  }

  private walkTree(node: unknown, visitor: (node: unknown) => void): void {
    if (node === null || node === undefined) return;
    visitor(node);
    if (Array.isArray(node)) {
      for (const item of node) this.walkTree(item, visitor);
    } else if (typeof node === "object") {
      for (const value of Object.values(node as Record<string, unknown>)) {
        this.walkTree(value, visitor);
      }
    }
  }

  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase();
  }
}

export async function runPlannerAgent(input: PlannerInput): Promise<PlannerOutput> {
  const agent = new PlannerAgent();
  return agent.execute(input);
}
