import { v4 as uuidv4 } from "uuid";
import * as path from "path";
import {
  OrchestratorConfig,
  OrchestratorResult,
  PlannerInput,
  PlannerOutput,
  ParserInput,
  ParserOutput,
  ExplorerInput,
  ExplorerOutput,
  MappingInput,
  MappingOutput,
  GeneratorInput,
  GeneratorOutput,
  ValidatorInput,
  ValidatorOutput,
  FixerInput,
  FixerOutput,
  TelemetryInput,
  TelemetryReport,
} from "../types";
import { createLogger } from "../utils/logger";
import { PlannerAgent } from "../agents/planner";
import { ParserAgent } from "../agents/parser";
import { ExplorerAgent } from "../agents/explorer";
import { MappingAgent } from "../agents/mapping";
import { GeneratorAgent } from "../agents/generator";
import { ValidatorAgent } from "../agents/validator";
import { FixerAgent } from "../agents/fixer";
import { TelemetryAgent } from "../agents/telemetry";

const logger = createLogger("orchestrator");

/**
 * Orchestrator Agent
 *
 * Full pipeline:
 *   1. Planner   → decide strategy
 *   2. Parser    → extract steps from Provar XML
 *   3. Explorer  → scan live UI (optional)
 *   4. Mapping   → combine parsed data + UI map
 *   5. Generator → create Playwright tests
 *   6. Validator → execute tests
 *   7. Fixer     → fix failures (optional, if any)
 *   8. Telemetry → record metrics (optional)
 */
export class Orchestrator {
  private config: OrchestratorConfig;

  // Agent instances
  private planner = new PlannerAgent();
  private parser = new ParserAgent();
  private explorer = new ExplorerAgent();
  private mapper = new MappingAgent();
  private generator = new GeneratorAgent();
  private validator = new ValidatorAgent();
  private fixer = new FixerAgent();
  private telemetry = new TelemetryAgent();

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  async orchestrate(): Promise<OrchestratorResult> {
    const runId = uuidv4();
    const startTime = new Date().toISOString();
    const timer = logger.startTimer();

    logger.info("═══════════════════════════════════════════════");
    logger.info("  Provar → Playwright Migration Orchestrator");
    logger.info("═══════════════════════════════════════════════");
    logger.info(`Run ID: ${runId}`);
    logger.info(`Input:  ${this.config.inputFile}`);
    logger.info(`Output: ${this.config.outputDir}`);

    let plannerOutput: PlannerOutput;
    let parserOutput: ParserOutput;
    let explorerOutput: ExplorerOutput | undefined;
    let mappingOutput: MappingOutput;
    let generatorOutput: GeneratorOutput;
    let validatorOutput: ValidatorOutput;
    let fixerOutput: FixerOutput | undefined;
    let telemetryReport: TelemetryReport | undefined;
    let status: OrchestratorResult["status"] = "success";

    try {
      // ── Step 1: Planner ──────────────────────────────────
      logger.info("─── Step 1/8: Planner Agent ───");
      const plannerInput: PlannerInput = {
        provarXml: this.config.inputFile,
        metadata: this.config.metadata,
      };
      plannerOutput = await this.planner.execute(plannerInput);
      logger.info(`Strategy: ${plannerOutput.strategy} | Complexity: ${plannerOutput.complexity.overall}`);

      // ── Step 2: Parser ───────────────────────────────────
      logger.info("─── Step 2/8: Parser Agent ───");
      const parserInput: ParserInput = {
        provarXml: this.config.inputFile,
      };
      parserOutput = await this.parser.execute(parserInput);
      logger.info(`Parsed ${parserOutput.testCases.length} test cases, ${parserOutput.totalSteps} steps`);

      // ── Step 3: Explorer (optional) ──────────────────────
      if (this.config.enableExplorer) {
        logger.info("─── Step 3/8: Explorer Agent ───");
        const explorerInput: ExplorerInput = {
          baseUrl: this.config.metadata.baseUrl,
          credentials: this.config.metadata.credentials,
          strategy: plannerOutput.strategy,
        };
        explorerOutput = await this.explorer.execute(explorerInput);
        logger.info(`Discovered ${explorerOutput.totalElements} elements across ${explorerOutput.pages.length} pages`);
      } else {
        logger.info("─── Step 3/8: Explorer Agent (SKIPPED) ───");
        explorerOutput = {
          pages: [],
          totalElements: 0,
          locatorBreakdown: {
            getByRole: 0, getByLabel: 0, getByTestId: 0,
            getByText: 0, getByPlaceholder: 0, css: 0, xpath: 0,
          },
          warnings: ["Explorer disabled — using Provar selectors directly"],
        };
      }

      // ── Step 4: Mapping ──────────────────────────────────
      logger.info("─── Step 4/8: Mapping Agent ───");
      const mappingInput: MappingInput = {
        parsedTests: parserOutput,
        uiMap: explorerOutput,
        strategy: plannerOutput.strategy,
      };
      mappingOutput = await this.mapper.execute(mappingInput);
      logger.info(`Mapping confidence: ${mappingOutput.overallConfidence}%`);

      // ── Step 5: Generator ────────────────────────────────
      logger.info("─── Step 5/8: Generator Agent ───");
      const generatorInput: GeneratorInput = {
        mappedTests: mappingOutput,
        plannerOutput,
        outputDir: this.config.outputDir,
      };
      generatorOutput = await this.generator.execute(generatorInput);
      logger.info(`Generated ${generatorOutput.totalFiles} files`);

      // ── Step 6: Validator ────────────────────────────────
      logger.info("─── Step 6/8: Validator Agent ───");
      const validatorInput: ValidatorInput = {
        tests: generatorOutput.tests,
        baseUrl: this.config.metadata.baseUrl,
        credentials: this.config.metadata.credentials,
      };
      validatorOutput = await this.validator.execute(validatorInput);
      logger.info(
        `Results: ${validatorOutput.passed} passed, ${validatorOutput.failed} failed, ${validatorOutput.flaky} flaky`
      );

      // ── Step 7: Fixer (if failures and enabled) ──────────
      if (this.config.enableFixer && validatorOutput.failed > 0) {
        logger.info("─── Step 7/8: Fixer Agent ───");
        const failedResults = validatorOutput.results.filter((r) => r.status === "failed");
        const fixerInput: FixerInput = {
          failedTests: failedResults,
          generatedTests: generatorOutput.tests,
          uiMap: explorerOutput,
        };
        fixerOutput = await this.fixer.execute(fixerInput);
        logger.info(`Fixed ${fixerOutput.fixes.length}, unfixable: ${fixerOutput.unfixable.length}`);

        // Re-validate fixed tests
        if (fixerOutput.fixedTests.length > 0) {
          logger.info("Re-validating fixed tests...");
          const revalidateInput: ValidatorInput = {
            tests: fixerOutput.fixedTests,
            baseUrl: this.config.metadata.baseUrl,
            credentials: this.config.metadata.credentials,
          };
          const revalidated = await this.validator.execute(revalidateInput);

          // Merge results: replace failed results with re-validated ones
          for (const reResult of revalidated.results) {
            const idx = validatorOutput.results.findIndex(
              (r) => r.fileName === reResult.fileName
            );
            if (idx !== -1) {
              validatorOutput.results[idx] = reResult;
            }
          }

          // Recalculate totals
          validatorOutput.passed = validatorOutput.results.filter((r) => r.status === "passed").length;
          validatorOutput.failed = validatorOutput.results.filter((r) => r.status === "failed").length;
          validatorOutput.flaky = validatorOutput.results.filter((r) => r.status === "flaky").length;
        }
      } else {
        logger.info("─── Step 7/8: Fixer Agent (SKIPPED) ───");
      }

      // ── Step 8: Telemetry ────────────────────────────────
      if (this.config.enableTelemetry) {
        logger.info("─── Step 8/8: Telemetry Agent ───");
        const telemetryInput: TelemetryInput = {
          validatorOutput,
          fixerOutput,
          plannerOutput,
          runId,
          startTime,
        };
        telemetryReport = await this.telemetry.execute(telemetryInput);
        logger.info(`Success rate: ${telemetryReport.successRate}%`);
      } else {
        logger.info("─── Step 8/8: Telemetry Agent (SKIPPED) ───");
      }

      // Determine overall status
      if (validatorOutput.failed > 0) {
        status = validatorOutput.passed > 0 ? "partial" : "failed";
      }
    } catch (err) {
      logger.error("Orchestration failed", err);
      throw err;
    }

    const duration = `${(timer() / 1000).toFixed(1)}s`;

    logger.info("═══════════════════════════════════════════════");
    logger.info(`  Migration complete — ${status.toUpperCase()} (${duration})`);
    logger.info("═══════════════════════════════════════════════");

    return {
      runId,
      status,
      plannerOutput: plannerOutput!,
      parserOutput: parserOutput!,
      explorerOutput,
      mappingOutput: mappingOutput!,
      generatorOutput: generatorOutput!,
      validatorOutput: validatorOutput!,
      fixerOutput,
      telemetryReport,
      duration,
    };
  }
}

// ── CLI Entry Point ─────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log(`
Usage: ts-node orchestrator/index.ts <provar-xml> [options]

Options:
  --base-url <url>       Base URL for the application (default: https://login.salesforce.com)
  --output <dir>         Output directory (default: ./output)
  --app-type <type>      App type: salesforce | custom-web | hybrid (default: salesforce)
  --no-explorer          Disable Explorer Agent (skip live UI scanning)
  --no-fixer             Disable Fixer Agent (skip auto-fix)
  --no-telemetry         Disable Telemetry Agent (skip metrics)
  --max-retries <n>      Max retry count for fixer (default: 2)
`);
    process.exit(1);
  }

  const inputFile = path.resolve(args[0]);
  const baseUrl = getArg(args, "--base-url") ?? "https://login.salesforce.com";
  const outputDir = path.resolve(getArg(args, "--output") ?? "./output");
  const appType = (getArg(args, "--app-type") ?? "salesforce") as "salesforce" | "custom-web" | "hybrid";

  const config: OrchestratorConfig = {
    inputFile,
    metadata: {
      appType,
      baseUrl,
      lightningEnabled: appType === "salesforce",
    },
    outputDir,
    maxRetries: parseInt(getArg(args, "--max-retries") ?? "2", 10),
    enableExplorer: !args.includes("--no-explorer"),
    enableFixer: !args.includes("--no-fixer"),
    enableTelemetry: !args.includes("--no-telemetry"),
  };

  const orchestrator = new Orchestrator(config);
  const result = await orchestrator.orchestrate();

  console.log("\n📊 Final Report:");
  console.log(JSON.stringify(result.telemetryReport ?? { status: result.status }, null, 2));
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
