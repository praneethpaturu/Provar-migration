// ============================================================
// Provar Migration System — Shared Type Definitions
// ============================================================

// ── Agent Metadata ──────────────────────────────────────────

export interface AgentContext {
  runId: string;
  timestamp: string;
  agentName: string;
}

export type MigrationStrategy = "ui-based" | "api-based" | "hybrid";

// ── Planner Agent ───────────────────────────────────────────

export interface PlannerInput {
  provarXml: string;
  metadata: AppMetadata;
  historicalTelemetry?: TelemetryReport;
}

export interface AppMetadata {
  appType: "salesforce" | "custom-web" | "hybrid";
  baseUrl: string;
  credentials?: Credentials;
  salesforceOrg?: string;
  lightningEnabled?: boolean;
}

export interface Credentials {
  username: string;
  password: string;
  securityToken?: string;
}

export interface PlannerOutput {
  strategy: MigrationStrategy;
  priority: string[];
  risks: string[];
  recommendations: string[];
  complexity: TestComplexity;
  reusableFlows: ReusableFlow[];
  pageObjectSuggestions: PageObjectSuggestion[];
  automationDecision: "full-automation" | "partial-manual-review";
}

export interface TestComplexity {
  overall: "low" | "medium" | "high";
  totalSteps: number;
  uiInteractions: number;
  apiCalls: number;
  assertions: number;
  dynamicElements: number;
}

export interface ReusableFlow {
  name: string;
  steps: string[];
  frequency: number;
}

export interface PageObjectSuggestion {
  pageName: string;
  elements: string[];
  suggestedFileName: string;
}

// ── Parser Agent ────────────────────────────────────────────

export interface ParserInput {
  provarXml: string;
}

export interface ParsedTestCase {
  name: string;
  description?: string;
  steps: ParsedStep[];
  tags?: string[];
}

export interface ParsedStep {
  action: StepAction;
  target?: string;
  value?: string;
  selector?: string;
  selectorType?: "xpath" | "css" | "id" | "name" | "label";
  waitCondition?: string;
  assertion?: ParsedAssertion;
}

export type StepAction =
  | "navigate"
  | "click"
  | "type"
  | "select"
  | "assert"
  | "wait"
  | "hover"
  | "drag"
  | "screenshot"
  | "api-call"
  | "iframe-switch"
  | "scroll";

export interface ParsedAssertion {
  type: "visible" | "text" | "value" | "enabled" | "count" | "url" | "title";
  expected: string;
  operator: "equals" | "contains" | "matches" | "greaterThan" | "lessThan";
}

export interface ParserOutput {
  testCases: ParsedTestCase[];
  totalSteps: number;
  warnings: string[];
}

// ── Explorer Agent ──────────────────────────────────────────

export interface ExplorerInput {
  baseUrl: string;
  credentials?: Credentials;
  pagesToScan?: string[];
  strategy: MigrationStrategy;
}

export interface DiscoveredPage {
  name: string;
  url: string;
  elements: DiscoveredElement[];
  iframes: IframeInfo[];
  dynamicRegions: string[];
}

export interface DiscoveredElement {
  role?: string;
  name?: string;
  label?: string;
  testId?: string;
  tagName: string;
  locatorStrategy: LocatorStrategy;
  locator: string;
  isInteractive: boolean;
  withinIframe?: string;
}

export type LocatorStrategy =
  | "getByRole"
  | "getByLabel"
  | "getByTestId"
  | "getByText"
  | "getByPlaceholder"
  | "css"
  | "xpath";

export interface IframeInfo {
  selector: string;
  name?: string;
  src?: string;
}

export interface ExplorerOutput {
  pages: DiscoveredPage[];
  totalElements: number;
  locatorBreakdown: Record<LocatorStrategy, number>;
  warnings: string[];
}

// ── Mapping Agent ───────────────────────────────────────────

export interface MappingInput {
  parsedTests: ParserOutput;
  uiMap: ExplorerOutput;
  strategy: MigrationStrategy;
}

export interface MappedTestCase {
  name: string;
  steps: MappedStep[];
  pageObjectsUsed: string[];
  confidence: number; // 0-100
  unmappedSteps: number;
}

export interface MappedStep {
  original: ParsedStep;
  playwrightAction: string;
  locator: string;
  locatorStrategy: LocatorStrategy;
  confidence: number;
  needsReview: boolean;
  reviewReason?: string;
}

export interface MappingOutput {
  testCases: MappedTestCase[];
  overallConfidence: number;
  unmappedElements: string[];
  warnings: string[];
}

// ── Generator Agent ─────────────────────────────────────────

export interface GeneratorInput {
  mappedTests: MappingOutput;
  plannerOutput: PlannerOutput;
  outputDir: string;
}

export interface GeneratedTest {
  fileName: string;
  filePath: string;
  code: string;
  testCount: number;
  pageObjectsGenerated: string[];
}

export interface GeneratorOutput {
  tests: GeneratedTest[];
  pageObjects: GeneratedPageObject[];
  totalFiles: number;
  warnings: string[];
}

export interface GeneratedPageObject {
  fileName: string;
  filePath: string;
  code: string;
  pageName: string;
}

// ── Validator Agent ─────────────────────────────────────────

export interface ValidatorInput {
  tests: GeneratedTest[];
  baseUrl: string;
  credentials?: Credentials;
  timeout?: number;
}

export interface TestResult {
  testName: string;
  fileName: string;
  status: "passed" | "failed" | "skipped" | "flaky";
  duration: number;
  error?: TestError;
  retries: number;
}

export interface TestError {
  message: string;
  stack?: string;
  type: "locator" | "timeout" | "assertion" | "navigation" | "syntax" | "unknown";
  line?: number;
  suggestion?: string;
}

export interface ValidatorOutput {
  results: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  totalDuration: number;
}

// ── Fixer Agent ─────────────────────────────────────────────

export interface FixerInput {
  failedTests: TestResult[];
  generatedTests: GeneratedTest[];
  uiMap: ExplorerOutput;
}

export interface FixResult {
  testName: string;
  originalError: string;
  fixApplied: string;
  fixType: "locator-update" | "wait-added" | "assertion-adjusted" | "iframe-handled" | "selector-replaced";
  updatedCode: string;
  confidence: number;
}

export interface FixerOutput {
  fixes: FixResult[];
  fixedTests: GeneratedTest[];
  unfixable: string[];
  warnings: string[];
}

// ── Telemetry Agent ─────────────────────────────────────────

export interface TelemetryInput {
  validatorOutput: ValidatorOutput;
  fixerOutput?: FixerOutput;
  plannerOutput: PlannerOutput;
  runId: string;
  startTime: string;
}

export interface TelemetryReport {
  runId: string;
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  autoFixed: number;
  flaky: number;
  successRate: number;
  avgExecutionTime: string;
  migrationCoverage: number;
  strategyUsed: MigrationStrategy;
  agentMetrics: AgentMetric[];
  failurePatterns: FailurePattern[];
  duration: string;
}

export interface AgentMetric {
  agentName: string;
  executionTime: number;
  itemsProcessed: number;
  successRate: number;
}

export interface FailurePattern {
  pattern: string;
  count: number;
  affectedTests: string[];
  suggestedFix: string;
}

// ── Orchestrator ────────────────────────────────────────────

export interface OrchestratorConfig {
  inputFile: string;
  metadata: AppMetadata;
  outputDir: string;
  maxRetries: number;
  enableExplorer: boolean;
  enableFixer: boolean;
  enableTelemetry: boolean;
}

export interface OrchestratorResult {
  runId: string;
  status: "success" | "partial" | "failed";
  plannerOutput: PlannerOutput;
  parserOutput: ParserOutput;
  explorerOutput?: ExplorerOutput;
  mappingOutput: MappingOutput;
  generatorOutput: GeneratorOutput;
  validatorOutput: ValidatorOutput;
  fixerOutput?: FixerOutput;
  telemetryReport?: TelemetryReport;
  duration: string;
}
