import { XMLParser } from "fast-xml-parser";
import * as fs from "fs";
import {
  ParserInput,
  ParserOutput,
  ParsedTestCase,
  ParsedStep,
  StepAction,
  ParsedAssertion,
} from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("parser-agent");

// Maps Provar XML action names → normalized StepAction
const ACTION_MAP: Record<string, StepAction> = {
  click: "click",
  Click: "click",
  set: "type",
  Set: "type",
  typeText: "type",
  read: "assert",
  Read: "assert",
  assert: "assert",
  Assert: "assert",
  validate: "assert",
  Validate: "assert",
  open: "navigate",
  Open: "navigate",
  navigate: "navigate",
  NavigateToUrl: "navigate",
  select: "select",
  Select: "select",
  hover: "hover",
  Hover: "hover",
  wait: "wait",
  Wait: "wait",
  pause: "wait",
  screenshot: "screenshot",
  Screenshot: "screenshot",
  switchFrame: "iframe-switch",
  SwitchFrame: "iframe-switch",
  scroll: "scroll",
  Scroll: "scroll",
  drag: "drag",
  DragAndDrop: "drag",
  apiCall: "api-call",
  APICall: "api-call",
  callMethod: "api-call",
};

export class ParserAgent {
  private xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: true,
      isArray: (tagName) =>
        ["testStep", "step", "TestStep", "testCase", "TestCase"].includes(tagName),
    });
  }

  async execute(input: ParserInput): Promise<ParserOutput> {
    const timer = logger.startTimer();
    logger.info("Parsing Provar XML", { file: input.provarXml });

    const xmlContent = fs.readFileSync(input.provarXml, "utf-8");
    const parsed = this.xmlParser.parse(xmlContent);
    const warnings: string[] = [];

    const testCases = this.extractTestCases(parsed, warnings);
    const totalSteps = testCases.reduce((sum, tc) => sum + tc.steps.length, 0);

    const output: ParserOutput = {
      testCases,
      totalSteps,
      warnings,
    };

    logger.info("Parsing complete", {
      testCases: testCases.length,
      totalSteps,
      warnings: warnings.length,
      duration: `${timer()}ms`,
    });

    return output;
  }

  private extractTestCases(
    parsed: Record<string, unknown>,
    warnings: string[]
  ): ParsedTestCase[] {
    const testCases: ParsedTestCase[] = [];
    const rawCases = this.findTestCases(parsed);

    for (const raw of rawCases) {
      const name =
        String(raw["@_name"] ?? raw["@_testName"] ?? raw["name"] ?? `test-${testCases.length + 1}`);
      const description =
        (raw["@_description"] ?? raw["description"]) as string | undefined;

      const rawSteps = this.findSteps(raw);
      const steps: ParsedStep[] = [];

      for (const rawStep of rawSteps) {
        const step = this.parseStep(rawStep, warnings);
        if (step) steps.push(step);
      }

      const tags = this.extractTags(raw);

      testCases.push({ name, description, steps, tags });
    }

    return testCases;
  }

  private parseStep(
    raw: Record<string, unknown>,
    warnings: string[]
  ): ParsedStep | null {
    const rawAction = String(
      raw["@_action"] ?? raw["@_type"] ?? raw["action"] ?? raw["type"] ?? ""
    );

    const action = ACTION_MAP[rawAction];
    if (!action) {
      warnings.push(`Unknown action: "${rawAction}" — skipping step`);
      return null;
    }

    const target = (raw["@_target"] ?? raw["@_page"] ?? raw["target"]) as string | undefined;
    const value = (raw["@_value"] ?? raw["@_text"] ?? raw["value"]) as string | undefined;

    const selector = (raw["@_locator"] ?? raw["@_xpath"] ?? raw["@_field"] ??
      raw["@_selector"] ?? raw["locator"]) as string | undefined;

    const selectorType = this.detectSelectorType(selector);

    const waitCondition = (raw["@_waitFor"] ?? raw["@_wait"]) as string | undefined;

    let assertion: ParsedAssertion | undefined;
    if (action === "assert") {
      assertion = this.parseAssertion(raw);
    }

    return {
      action,
      target,
      value,
      selector,
      selectorType,
      waitCondition,
      assertion,
    };
  }

  private parseAssertion(raw: Record<string, unknown>): ParsedAssertion | undefined {
    const expected = (raw["@_expected"] ?? raw["@_value"] ?? raw["expected"]) as string | undefined;
    if (!expected) return undefined;

    const typeStr = String(raw["@_assertType"] ?? raw["@_checkType"] ?? "text");
    const type = (["visible", "text", "value", "enabled", "count", "url", "title"].includes(typeStr)
      ? typeStr
      : "text") as ParsedAssertion["type"];

    const operatorStr = String(raw["@_operator"] ?? raw["@_comparison"] ?? "equals");
    const operator = (["equals", "contains", "matches", "greaterThan", "lessThan"].includes(operatorStr)
      ? operatorStr
      : "equals") as ParsedAssertion["operator"];

    return { type, expected, operator };
  }

  private detectSelectorType(
    selector: string | undefined
  ): ParsedStep["selectorType"] | undefined {
    if (!selector) return undefined;
    if (selector.startsWith("//") || selector.startsWith("(//")) return "xpath";
    if (selector.startsWith("#")) return "css";
    if (selector.startsWith(".")) return "css";
    if (/^[a-zA-Z][\w-]*$/.test(selector)) return "id";
    if (selector.includes("[")) return "css";
    return "name";
  }

  private findTestCases(node: unknown): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    this.walk(node, (n) => {
      if (n && typeof n === "object" && !Array.isArray(n)) {
        const keys = Object.keys(n as object);
        if (
          keys.some((k) =>
            ["@_testName", "@_name", "testStep", "TestStep", "step", "steps"].includes(k)
          )
        ) {
          // Check if this looks like a test case (has steps)
          const obj = n as Record<string, unknown>;
          if (obj["testStep"] || obj["TestStep"] || obj["step"] || obj["steps"]) {
            results.push(obj);
          }
        }
      }
    });
    // If no structured cases found, treat root as single test case
    if (results.length === 0 && typeof node === "object" && node !== null) {
      results.push(node as Record<string, unknown>);
    }
    return results;
  }

  private findSteps(testCase: Record<string, unknown>): Record<string, unknown>[] {
    const steps =
      testCase["testStep"] ??
      testCase["TestStep"] ??
      testCase["step"] ??
      testCase["steps"];

    if (Array.isArray(steps)) return steps as Record<string, unknown>[];
    if (steps && typeof steps === "object") return [steps as Record<string, unknown>];
    return [];
  }

  private extractTags(testCase: Record<string, unknown>): string[] {
    const tags = testCase["@_tags"] ?? testCase["tags"];
    if (typeof tags === "string") return tags.split(",").map((t) => t.trim());
    if (Array.isArray(tags)) return tags.map(String);
    return [];
  }

  private walk(node: unknown, visitor: (n: unknown) => void): void {
    if (node === null || node === undefined) return;
    visitor(node);
    if (Array.isArray(node)) {
      for (const item of node) this.walk(item, visitor);
    } else if (typeof node === "object") {
      for (const value of Object.values(node as Record<string, unknown>)) {
        this.walk(value, visitor);
      }
    }
  }
}

export async function runParserAgent(input: ParserInput): Promise<ParserOutput> {
  const agent = new ParserAgent();
  return agent.execute(input);
}
