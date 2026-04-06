import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  ValidatorInput,
  ValidatorOutput,
  TestResult,
  TestError,
  GeneratedTest,
} from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("validator-agent");

export class ValidatorAgent {
  async execute(input: ValidatorInput): Promise<ValidatorOutput> {
    const timer = logger.startTimer();
    logger.info("Starting test validation", { testCount: input.tests.length });

    const results: TestResult[] = [];
    const timeout = input.timeout ?? 60000;

    for (const test of input.tests) {
      const result = await this.runTest(test, timeout);
      results.push(result);
    }

    const passed = results.filter((r) => r.status === "passed").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const flaky = results.filter((r) => r.status === "flaky").length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    const output: ValidatorOutput = {
      results,
      passed,
      failed,
      skipped,
      flaky,
      totalDuration,
    };

    logger.info("Validation complete", {
      passed,
      failed,
      skipped,
      flaky,
      totalDuration: `${(totalDuration / 1000).toFixed(1)}s`,
      duration: `${timer()}ms`,
    });

    return output;
  }

  private async runTest(test: GeneratedTest, timeout: number): Promise<TestResult> {
    const startTime = Date.now();
    const maxRetries = 2;
    let lastError: TestError | undefined;
    let status: TestResult["status"] = "failed";
    let retries = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // First check for syntax errors
        this.syntaxCheck(test);

        // Run via Playwright test runner
        const testDir = path.dirname(test.filePath);
        const configPath = path.join(testDir, "..", "playwright.config.ts");

        const cmd = `npx playwright test "${test.filePath}" --reporter=json --timeout=${timeout}`;

        const result = execSync(cmd, {
          cwd: path.dirname(configPath),
          timeout: timeout + 10000,
          encoding: "utf-8",
          env: {
            ...process.env,
            PLAYWRIGHT_JSON_OUTPUT_NAME: "test-results/last-run.json",
          },
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Parse JSON output
        const jsonResult = this.parsePlaywrightOutput(testDir, test.fileName);
        if (jsonResult) {
          return jsonResult;
        }

        status = "passed";
        lastError = undefined;
        break;
      } catch (err) {
        retries = attempt;
        lastError = this.classifyError(err);

        // If it passed on retry, mark as flaky
        if (attempt > 0 && status === "passed") {
          status = "flaky";
          break;
        }
      }
    }

    // If it failed then passed on a later retry → flaky
    if (lastError && retries > 0 && status === "passed") {
      status = "flaky";
    }

    const duration = Date.now() - startTime;

    return {
      testName: test.fileName.replace(".spec.ts", ""),
      fileName: test.fileName,
      status: lastError ? "failed" : status,
      duration,
      error: lastError,
      retries,
    };
  }

  private syntaxCheck(test: GeneratedTest): void {
    // Quick TypeScript syntax validation
    try {
      const cmd = `npx tsc --noEmit --strict "${test.filePath}" 2>&1 || true`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 15000 });

      if (output.includes("error TS")) {
        const errorLines = output
          .split("\n")
          .filter((l) => l.includes("error TS"))
          .slice(0, 3);

        throw {
          type: "syntax",
          message: errorLines.join("; "),
        };
      }
    } catch (err) {
      if ((err as { type?: string }).type === "syntax") throw err;
      // tsc not available or other issue — skip syntax check
    }
  }

  private parsePlaywrightOutput(testDir: string, fileName: string): TestResult | null {
    const resultPath = path.join(testDir, "..", "test-results", "last-run.json");

    if (!fs.existsSync(resultPath)) return null;

    try {
      const raw = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
      const suites = raw.suites ?? [];

      for (const suite of suites) {
        for (const spec of suite.specs ?? []) {
          const test = spec.tests?.[0];
          if (!test) continue;

          const results = test.results ?? [];
          const lastResult = results[results.length - 1];

          let error: TestError | undefined;
          if (lastResult?.error) {
            error = this.classifyError(lastResult.error);
          }

          return {
            testName: spec.title ?? fileName,
            fileName,
            status: test.status === "expected" ? "passed" : "failed",
            duration: lastResult?.duration ?? 0,
            error,
            retries: results.length - 1,
          };
        }
      }
    } catch {
      // Failed to parse — fall through
    }

    return null;
  }

  private classifyError(err: unknown): TestError {
    const message = this.extractErrorMessage(err);
    const stack = (err as { stack?: string }).stack;

    let type: TestError["type"] = "unknown";
    let suggestion: string | undefined;

    if (message.includes("locator") || message.includes("selector") || message.includes("not found")) {
      type = "locator";
      suggestion = "Update selector — consider using getByRole or getByTestId";
    } else if (message.includes("timeout") || message.includes("Timeout")) {
      type = "timeout";
      suggestion = "Increase timeout or use waitForLoadState before interaction";
    } else if (message.includes("expect") || message.includes("assertion") || message.includes("toBe")) {
      type = "assertion";
      suggestion = "Verify expected value — data may have changed";
    } else if (message.includes("ERR_NAME_NOT_RESOLVED") || message.includes("navigate") || message.includes("goto")) {
      type = "navigation";
      suggestion = "Verify URL is correct and accessible";
    } else if (message.includes("error TS") || message.includes("SyntaxError")) {
      type = "syntax";
      suggestion = "Fix TypeScript compilation error";
    }

    return { message, stack, type, suggestion };
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      return (err as { message?: string }).message ?? JSON.stringify(err).substring(0, 200);
    }
    return String(err);
  }
}

export async function runValidatorAgent(input: ValidatorInput): Promise<ValidatorOutput> {
  const agent = new ValidatorAgent();
  return agent.execute(input);
}
