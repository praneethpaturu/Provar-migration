# Provar → Playwright Migration Agents

This document defines all agents for the multi-agent QA migration system.
These agents are designed to be orchestrated via the central Orchestrator Agent
and integrated with GitHub Copilot Agents.

---

## Orchestrator Agent

**Role:** Central controller that sequences all agents in the correct order.

**Pipeline:**
```
Planner → Parser → Explorer → Mapping → Generator → Validator → Fixer → Telemetry
```

**Trigger:** When a `.testcase` or Provar XML file needs to be migrated to Playwright.

**File:** `orchestrator/index.ts`

**Usage:**
```bash
ts-node orchestrator/index.ts <provar-xml> --base-url <url> --output ./output
```

---

## Planner Agent

**Role:** Analyze Provar test XML and metadata to decide the optimal migration strategy BEFORE conversion begins.

**Trigger:** Start of every migration run — always runs first.

**Input:** Provar XML file, app metadata (Salesforce/custom-web/hybrid), optional historical telemetry.

**Output:** Strategy (`ui-based | api-based | hybrid`), priority list, risks, recommendations, complexity classification, Page Object Model suggestions, reusable flow detection.

**Key Decisions:**
- Classify test complexity (low / medium / high)
- Identify reusable flows (login, navigation)
- Suggest Page Object Model structure
- Choose full automation vs. partial manual review

**File:** `agents/planner.ts`

---

## Parser Agent

**Role:** Parse Provar XML test cases into normalized, structured step definitions.

**Trigger:** After Planner Agent completes.

**Input:** Provar XML file path (from `tests/` directory in Provar project).

**Output:** Array of `ParsedTestCase` with normalized steps, actions, selectors, and assertions.

**Understands:**
- Provar project structure: `tests/`, `src/pageobjects/`, `templates/`
- Provar XML action types: Click, Set, Read, Assert, Navigate, SwitchFrame, etc.
- Provar selector formats: XPath, CSS, ID, name, label

**File:** `agents/parser.ts`

---

## Explorer Agent

**Role:** Discover UI structure dynamically using Playwright browser automation.

**Trigger:** After Parser, when live UI scanning is enabled.

**Tools:** Playwright (`chromium`, `page`, `locator`, `frameLocator`)

**Input:** Base URL, optional credentials, pages to scan, migration strategy.

**Output:** Discovered pages with elements (role, label, name, testId), iframe info, dynamic region detection.

**Locator Strategy Preference:**
1. `getByRole` (preferred)
2. `getByLabel`
3. `getByTestId`
4. `getByPlaceholder`
5. `getByText`
6. CSS selector (fallback)
7. XPath (last resort)

**Special Handling:**
- Salesforce Lightning DOM stabilization
- Shadow DOM detection
- Aura component detection
- Iframe discovery and scanning

**File:** `agents/explorer.ts`

---

## Mapping Agent

**Role:** Combine parsed Provar test steps with discovered UI elements to produce Playwright-ready mapped steps.

**Trigger:** After both Parser and Explorer complete.

**Input:** Parser output + Explorer output + migration strategy.

**Output:** Mapped test cases with Playwright actions, locators, confidence scores, and review flags.

**Logic:**
- Score-based matching: element name, label, testId, role alignment
- Converts Provar XPath/CSS selectors to Playwright locators
- Flags low-confidence mappings for manual review

**File:** `agents/mapping.ts`

---

## Generator Agent

**Role:** Generate production-ready Playwright test files and Page Objects from mapped test data.

**Trigger:** After Mapping Agent completes.

**Input:** Mapped test cases + Planner output (for POM suggestions) + output directory.

**Output:** `.spec.ts` test files, Page Object `.page.ts` files, `playwright.config.ts`.

**Generates:**
- Test files with `test.describe` / `test` blocks
- `beforeEach` login hooks for reusable flows
- Page Object classes with locator getters
- Playwright config with Salesforce-optimized timeouts

**File:** `agents/generator.ts`

---

## Validator Agent

**Role:** Execute generated Playwright tests and collect results.

**Trigger:** After Generator Agent completes.

**Input:** Generated test files, base URL, credentials.

**Output:** Test results with pass/fail status, duration, error classification, retry count.

**Features:**
- TypeScript syntax pre-check
- Playwright test runner execution
- Error classification: locator / timeout / assertion / navigation / syntax
- Automatic retries for flaky detection

**File:** `agents/validator.ts`

---

## Fixer Agent

**Role:** Automatically fix failed tests based on error analysis and UI map data.

**Trigger:** After Validator, when failures are detected and Fixer is enabled.

**Input:** Failed test results, generated test code, Explorer UI map.

**Fix Types:**
- `locator-update` — replace broken selector with UI map alternative
- `wait-added` — add auto-waiting for timeout issues
- `assertion-adjusted` — relax exact match to contains
- `iframe-handled` — add frameLocator for iframe errors
- `selector-replaced` — swap CSS/XPath with role-based locator

**Output:** Fixed test code, fix descriptions, unfixable list.

**File:** `agents/fixer.ts`

---

## Telemetry Agent

**Role:** Track migration quality, system performance, and historical metrics.

**Trigger:** Final step in the pipeline.

**Input:** Validator results, Fixer results, Planner output, run metadata.

**Output:**
```json
{
  "totalTests": 100,
  "passed": 82,
  "failed": 18,
  "autoFixed": 10,
  "flaky": 5,
  "successRate": 82,
  "avgExecutionTime": "3.2s",
  "migrationCoverage": 85,
  "failurePatterns": [...],
  "agentMetrics": [...]
}
```

**Stores:** JSON reports in `metrics/`, maintains historical run data for trend analysis.

**File:** `agents/telemetry.ts`

---

## Copilot Integration

These agents can be invoked via GitHub Copilot:

- **@planner** — Analyze a Provar XML and suggest migration strategy
- **@parser** — Parse Provar test XML into structured steps
- **@explorer** — Scan a URL and discover UI elements with best locators
- **@mapper** — Map Provar steps to Playwright locators
- **@generator** — Generate Playwright test files from mapped data
- **@validator** — Run generated tests and report results
- **@fixer** — Auto-fix failing tests
- **@telemetry** — Generate migration quality report
- **@orchestrate** — Run the full pipeline end-to-end

### Copilot Prompts

```
@planner Analyze tests/LoginTest.testcase for Salesforce Lightning migration
@explorer Scan https://myorg.lightning.force.com and discover all interactive elements
@orchestrate Migrate tests/SmokeTest.testcase --base-url https://myorg.my.salesforce.com
```
