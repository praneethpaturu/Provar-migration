import * as fs from "fs";
import * as path from "path";
import {
  TelemetryInput,
  TelemetryReport,
  AgentMetric,
  FailurePattern,
} from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("telemetry-agent");

const METRICS_DIR = path.resolve(__dirname, "..", "metrics");

export class TelemetryAgent {
  constructor() {
    if (!fs.existsSync(METRICS_DIR)) {
      fs.mkdirSync(METRICS_DIR, { recursive: true });
    }
  }

  async execute(input: TelemetryInput): Promise<TelemetryReport> {
    const timer = logger.startTimer();
    logger.info("Starting telemetry collection", { runId: input.runId });

    const { validatorOutput, fixerOutput, plannerOutput, runId, startTime } = input;

    const autoFixed = fixerOutput?.fixes.length ?? 0;
    const totalTests = validatorOutput.results.length;
    const passed = validatorOutput.passed + autoFixed;
    const failed = validatorOutput.failed - autoFixed;
    const flaky = validatorOutput.flaky;
    const successRate = totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0;

    const totalDurationMs = validatorOutput.results.reduce((sum, r) => sum + r.duration, 0);
    const avgExecutionTime =
      totalTests > 0
        ? `${(totalDurationMs / totalTests / 1000).toFixed(1)}s`
        : "0s";

    const failurePatterns = this.analyzeFailurePatterns(validatorOutput.results);
    const agentMetrics = this.collectAgentMetrics(input);
    const migrationCoverage = this.calculateCoverage(input);

    const endTime = new Date();
    const startDate = new Date(startTime);
    const duration = `${((endTime.getTime() - startDate.getTime()) / 1000).toFixed(1)}s`;

    const report: TelemetryReport = {
      runId,
      timestamp: endTime.toISOString(),
      totalTests,
      passed,
      failed: Math.max(0, failed),
      autoFixed,
      flaky,
      successRate,
      avgExecutionTime,
      migrationCoverage,
      strategyUsed: plannerOutput.strategy,
      agentMetrics,
      failurePatterns,
      duration,
    };

    // Persist to JSON
    this.persistReport(report);

    // Persist summary for historical lookups
    this.updateHistoricalMetrics(report);

    logger.info("Telemetry collection complete", {
      successRate: `${successRate}%`,
      totalTests,
      passed,
      failed: Math.max(0, failed),
      autoFixed,
      duration: `${timer()}ms`,
    });

    return report;
  }

  private analyzeFailurePatterns(
    results: TelemetryInput["validatorOutput"]["results"]
  ): FailurePattern[] {
    const patternMap = new Map<
      string,
      { count: number; tests: string[]; errorType: string }
    >();

    const failedResults = results.filter((r) => r.status === "failed" && r.error);

    for (const result of failedResults) {
      const error = result.error!;
      const patternKey = error.type;

      const existing = patternMap.get(patternKey);
      if (existing) {
        existing.count++;
        existing.tests.push(result.testName);
      } else {
        patternMap.set(patternKey, {
          count: 1,
          tests: [result.testName],
          errorType: error.type,
        });
      }
    }

    const patterns: FailurePattern[] = [];

    for (const [pattern, data] of patternMap) {
      patterns.push({
        pattern,
        count: data.count,
        affectedTests: data.tests,
        suggestedFix: this.suggestFixForPattern(data.errorType),
      });
    }

    // Sort by count descending
    patterns.sort((a, b) => b.count - a.count);

    return patterns;
  }

  private suggestFixForPattern(errorType: string): string {
    const suggestions: Record<string, string> = {
      locator:
        "Update selectors to use getByRole/getByLabel; run Explorer Agent to rediscover elements",
      timeout:
        "Increase timeout or replace explicit waits with Playwright auto-waiting",
      assertion:
        "Review expected values — data may have changed or assertion operator may need adjustment",
      navigation:
        "Verify URLs are correct and accessible; check for redirects or auth gates",
      syntax:
        "Review generated code for TypeScript/Playwright syntax errors",
      unknown:
        "Manual review required — check logs for detailed error stack",
    };

    return suggestions[errorType] ?? suggestions["unknown"];
  }

  private collectAgentMetrics(input: TelemetryInput): AgentMetric[] {
    const metrics: AgentMetric[] = [];

    // Planner metrics
    metrics.push({
      agentName: "planner",
      executionTime: 0, // filled by orchestrator
      itemsProcessed: 1,
      successRate: 100,
    });

    // Validator metrics
    const valOut = input.validatorOutput;
    metrics.push({
      agentName: "validator",
      executionTime: valOut.totalDuration,
      itemsProcessed: valOut.results.length,
      successRate:
        valOut.results.length > 0
          ? Math.round((valOut.passed / valOut.results.length) * 100)
          : 0,
    });

    // Fixer metrics
    if (input.fixerOutput) {
      const fixOut = input.fixerOutput;
      const fixTotal = fixOut.fixes.length + fixOut.unfixable.length;
      metrics.push({
        agentName: "fixer",
        executionTime: 0,
        itemsProcessed: fixTotal,
        successRate:
          fixTotal > 0
            ? Math.round((fixOut.fixes.length / fixTotal) * 100)
            : 0,
      });
    }

    return metrics;
  }

  private calculateCoverage(input: TelemetryInput): number {
    const planned = input.plannerOutput.complexity.totalSteps;
    const tested = input.validatorOutput.results.length;
    if (planned === 0) return 100;
    return Math.min(100, Math.round((tested / planned) * 100));
  }

  private persistReport(report: TelemetryReport): void {
    const fileName = `telemetry-${report.runId}-${Date.now()}.json`;
    const filePath = path.join(METRICS_DIR, fileName);

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    logger.info(`Report saved: ${filePath}`);
  }

  private updateHistoricalMetrics(report: TelemetryReport): void {
    const historyFile = path.join(METRICS_DIR, "history.json");
    let history: TelemetryReport[] = [];

    if (fs.existsSync(historyFile)) {
      try {
        history = JSON.parse(fs.readFileSync(historyFile, "utf-8"));
      } catch {
        logger.warn("Could not parse history file, starting fresh");
      }
    }

    history.push(report);

    // Keep last 100 runs
    if (history.length > 100) {
      history = history.slice(-100);
    }

    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
  }
}

export async function runTelemetryAgent(input: TelemetryInput): Promise<TelemetryReport> {
  const agent = new TelemetryAgent();
  return agent.execute(input);
}
