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
import {
  resolveProvarProject,
  listTestFiles,
  listPageObjectFiles,
  readNitroXConfig,
} from "../utils/provar-reader";
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
Usage:
  ts-node orchestrator/index.ts <provar-xml>              Migrate a single test file
  ts-node orchestrator/index.ts --provar-project <dir>    Migrate an entire Provar project

Options:
  --provar-project <dir> Path to the Provar project root (auto-discovers tests, page objects, config)
  --base-url <url>       Base URL for the application (default: https://login.salesforce.com)
  --output <dir>         Output directory (default: ./output)
  --app-type <type>      App type: salesforce | custom-web | hybrid (default: salesforce)
  --no-explorer          Disable Explorer Agent (skip live UI scanning)
  --no-fixer             Disable Fixer Agent (skip auto-fix)
  --no-telemetry         Disable Telemetry Agent (skip metrics)
  --max-retries <n>      Max retry count for fixer (default: 2)

Examples:
  # Connect to your Provar project and migrate all tests
  ts-node orchestrator/index.ts --provar-project /path/to/Oliva

  # Migrate a single test file
  ts-node orchestrator/index.ts /path/to/Oliva/tests/LoginTest.testcase
`);
    process.exit(1);
  }

  const baseUrl = getArg(args, "--base-url") ?? "https://login.salesforce.com";
  const outputDir = path.resolve(getArg(args, "--output") ?? "./output");
  const appType = (getArg(args, "--app-type") ?? "salesforce") as "salesforce" | "custom-web" | "hybrid";
  const provarProjectPath = getArg(args, "--provar-project");

  // ── Provar Project Mode: auto-discover and migrate all tests ──
  if (provarProjectPath) {
    const projectRoot = path.resolve(provarProjectPath);
    const project = resolveProvarProject(projectRoot);

    logger.info("═══════════════════════════════════════════════");
    logger.info("  Provar Project Connection");
    logger.info("═══════════════════════════════════════════════");
    logger.info(`Project root:   ${project.rootDir}`);
    logger.info(`Tests dir:      ${project.testsDir}`);
    logger.info(`Page objects:   ${project.pageObjectsDir}`);

    // Read NitroX config for project settings
    const nitroXConfig = readNitroXConfig(project);
    if (nitroXConfig) {
      logger.info(`NitroX config:  loaded (${Object.keys(nitroXConfig).length} keys)`);
      // Extract base URL from NitroX config if available and not overridden
      const configUrl = nitroXConfig["baseUrl"] ?? nitroXConfig["environmentUrl"] ?? nitroXConfig["url"];
      if (configUrl && !args.includes("--base-url")) {
        logger.info(`Using base URL from nitroXConfig.json: ${configUrl}`);
      }
    }

    // Discover all test files
    const testFiles = listTestFiles(project);
    if (testFiles.length === 0) {
      console.error(`No test files found in ${project.testsDir}`);
      process.exit(1);
    }
    logger.info(`Discovered ${testFiles.length} test file(s):`);
    for (const f of testFiles) {
      logger.info(`  - ${path.relative(projectRoot, f)}`);
    }

    // Discover page objects for better mapping context
    const pageObjectFiles = listPageObjectFiles(project);
    if (pageObjectFiles.length > 0) {
      logger.info(`Found ${pageObjectFiles.length} Provar page object(s):`);
      for (const f of pageObjectFiles) {
        logger.info(`  - ${path.relative(projectRoot, f)}`);
      }
    }

    // Migrate each test file
    const results: OrchestratorResult[] = [];
    for (let i = 0; i < testFiles.length; i++) {
      const testFile = testFiles[i];
      const testName = path.basename(testFile, path.extname(testFile));

      logger.info("");
      logger.info(`━━━ Migrating [${i + 1}/${testFiles.length}]: ${testName} ━━━`);

      const config: OrchestratorConfig = {
        inputFile: testFile,
        metadata: {
          appType,
          baseUrl: String(
            (nitroXConfig?.["baseUrl"] ?? nitroXConfig?.["environmentUrl"] ?? baseUrl)
          ),
          lightningEnabled: appType === "salesforce",
        },
        outputDir: path.join(outputDir, testName),
        maxRetries: parseInt(getArg(args, "--max-retries") ?? "2", 10),
        enableExplorer: !args.includes("--no-explorer"),
        enableFixer: !args.includes("--no-fixer"),
        enableTelemetry: !args.includes("--no-telemetry"),
      };

      const orchestrator = new Orchestrator(config);
      const result = await orchestrator.orchestrate();
      results.push(result);
    }

    // Print summary for all tests
    console.log("\n");
    console.log("╔═══════════════════════════════════════════════════╗");
    console.log("║        Provar Project Migration Summary           ║");
    console.log("╠═══════════════════════════════════════════════════╣");
    console.log(`║  Project:         ${path.basename(projectRoot).padEnd(34)}║`);
    console.log(`║  Test files:      ${String(testFiles.length).padEnd(34)}║`);
    console.log(`║  Page objects:    ${String(pageObjectFiles.length).padEnd(34)}║`);
    console.log("╠═══════════════════════════════════════════════════╣");

    let totalPassed = 0;
    let totalFailed = 0;
    let totalFixed = 0;

    for (const r of results) {
      totalPassed += r.validatorOutput.passed;
      totalFailed += r.validatorOutput.failed;
      totalFixed += r.fixerOutput?.fixes.length ?? 0;

      const statusIcon = r.status === "success" ? "PASS" : r.status === "partial" ? "PARTIAL" : "FAIL";
      console.log(`║  ${statusIcon.padEnd(8)} ${r.plannerOutput.complexity.overall.padEnd(8)} ${path.basename(r.generatorOutput.tests[0]?.fileName ?? "unknown").padEnd(30).substring(0, 30)}║`);
    }

    console.log("╠═══════════════════════════════════════════════════╣");
    console.log(`║  Total passed:    ${String(totalPassed).padEnd(34)}║`);
    console.log(`║  Total failed:    ${String(totalFailed).padEnd(34)}║`);
    console.log(`║  Auto-fixed:      ${String(totalFixed).padEnd(34)}║`);
    console.log("╚═══════════════════════════════════════════════════╝");

    return;
  }

  // ── Single File Mode ──────────────────────────────────────
  const inputFile = path.resolve(args[0]);

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

  console.log("\nFinal Report:");
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
