/**
 * Sample execution flow — demonstrates the full orchestration pipeline
 *
 * Usage:
 *   ts-node samples/run-example.ts
 *
 * This uses the sample Provar XML to show how the system works end-to-end.
 */

import * as path from "path";
import { Orchestrator } from "../orchestrator";
import { OrchestratorConfig } from "../types";

async function main() {
  const projectRoot = path.resolve(__dirname, "..");

  const config: OrchestratorConfig = {
    inputFile: path.join(projectRoot, "samples", "sample-provar-test.xml"),
    metadata: {
      appType: "salesforce",
      baseUrl: "https://login.salesforce.com",
      lightningEnabled: true,
      credentials: {
        username: process.env.SF_USERNAME ?? "admin@example.com",
        password: process.env.SF_PASSWORD ?? "password123",
        securityToken: process.env.SF_TOKEN,
      },
    },
    outputDir: path.join(projectRoot, "output"),
    maxRetries: 2,
    enableExplorer: false,   // Set true if you have a live Salesforce org
    enableFixer: true,
    enableTelemetry: true,
  };

  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  Provar → Playwright Migration — Example Run     ║");
  console.log("╚═══════════════════════════════════════════════════╝");
  console.log();
  console.log(`Input:  ${config.inputFile}`);
  console.log(`Output: ${config.outputDir}`);
  console.log(`App:    ${config.metadata.appType} (Lightning: ${config.metadata.lightningEnabled})`);
  console.log();

  const orchestrator = new Orchestrator(config);
  const result = await orchestrator.orchestrate();

  console.log();
  console.log("┌─────────────────────────────────────────────────────┐");
  console.log("│                    RESULTS                          │");
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  Status:            ${result.status.toUpperCase().padEnd(32)}│`);
  console.log(`│  Duration:          ${result.duration.padEnd(32)}│`);
  console.log(`│  Strategy:          ${result.plannerOutput.strategy.padEnd(32)}│`);
  console.log(`│  Complexity:        ${result.plannerOutput.complexity.overall.padEnd(32)}│`);
  console.log(`│  Tests Parsed:      ${String(result.parserOutput.testCases.length).padEnd(32)}│`);
  console.log(`│  Steps Parsed:      ${String(result.parserOutput.totalSteps).padEnd(32)}│`);
  console.log(`│  Files Generated:   ${String(result.generatorOutput.totalFiles).padEnd(32)}│`);
  console.log(`│  Mapping Confidence: ${String(result.mappingOutput.overallConfidence + "%").padEnd(31)}│`);
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  Tests Passed:      ${String(result.validatorOutput.passed).padEnd(32)}│`);
  console.log(`│  Tests Failed:      ${String(result.validatorOutput.failed).padEnd(32)}│`);
  console.log(`│  Tests Flaky:       ${String(result.validatorOutput.flaky).padEnd(32)}│`);

  if (result.fixerOutput) {
    console.log(`│  Auto-Fixed:        ${String(result.fixerOutput.fixes.length).padEnd(32)}│`);
    console.log(`│  Unfixable:         ${String(result.fixerOutput.unfixable.length).padEnd(32)}│`);
  }

  if (result.telemetryReport) {
    console.log("├─────────────────────────────────────────────────────┤");
    console.log(`│  Success Rate:      ${String(result.telemetryReport.successRate + "%").padEnd(32)}│`);
    console.log(`│  Avg Execution:     ${result.telemetryReport.avgExecutionTime.padEnd(32)}│`);
    console.log(`│  Coverage:          ${String(result.telemetryReport.migrationCoverage + "%").padEnd(32)}│`);
  }

  console.log("└─────────────────────────────────────────────────────┘");

  // Print risks and recommendations
  if (result.plannerOutput.risks.length > 0) {
    console.log("\nRisks:");
    for (const risk of result.plannerOutput.risks) {
      console.log(`  - ${risk}`);
    }
  }

  if (result.plannerOutput.recommendations.length > 0) {
    console.log("\nRecommendations:");
    for (const rec of result.plannerOutput.recommendations) {
      console.log(`  - ${rec}`);
    }
  }

  // Print generated files
  console.log("\nGenerated Files:");
  for (const test of result.generatorOutput.tests) {
    console.log(`  - ${test.filePath}`);
  }
  for (const po of result.generatorOutput.pageObjects) {
    console.log(`  - ${po.filePath}`);
  }

  // Print telemetry report path
  if (result.telemetryReport) {
    console.log(`\nTelemetry Report: metrics/telemetry-${result.runId}-*.json`);
  }
}

main().catch((err) => {
  console.error("Example run failed:", err);
  process.exit(1);
});
