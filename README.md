# Provar → Playwright Migration System

A multi-agent orchestration system that automatically converts Provar QA test cases (XML) into production-ready Playwright test scripts, with built-in Salesforce Lightning support. All agents are defined as **GitHub Copilot Agents** and can be invoked directly from Copilot Chat.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator Agent                        │
├─────────┬────────┬──────────┬─────────┬───────────┬─────────┤
│ Planner → Parser → Explorer → Mapping → Generator → Validator│
│                                                    ↓        │
│                                              Fixer → Telemetry│
└─────────────────────────────────────────────────────────────┘
```

| Agent | Copilot File | Role |
|-------|-------------|------|
| **Orchestrator** | `orchestrator.agent.md` | Controls the full 8-step pipeline end-to-end |
| **Planner** | `planner.agent.md` | Decides migration strategy (ui-based / api-based / hybrid) |
| **Parser** | `parser.agent.md` | Extracts steps from Provar XML test cases |
| **Explorer** | `explorer.agent.md` | Scans live UI with Playwright to discover elements and locators |
| **Mapping** | `mapping.agent.md` | Matches parsed steps to discovered UI elements |
| **Generator** | `generator.agent.md` | Produces `.spec.ts` test files, Page Objects, and Playwright config |
| **Validator** | `validator.agent.md` | Runs generated tests and classifies errors |
| **Fixer** | `fixer.agent.md` | Auto-fixes failures (broken selectors, timeouts, assertions) |
| **Telemetry** | `telemetry.agent.md` | Tracks success rates, failure patterns, and migration coverage |

## GitHub Copilot Agents

All 9 agents are defined as **GitHub Copilot custom agents** in `.github/agents/` using the standard `.agent.md` format with YAML frontmatter.

### Agent Files

```
.github/agents/
├── orchestrator.agent.md   ← Full pipeline controller
├── planner.agent.md        ← Strategy & complexity analysis
├── parser.agent.md         ← Provar XML parsing
├── explorer.agent.md       ← Live UI discovery (Playwright)
├── mapping.agent.md        ← Step-to-locator matching
├── generator.agent.md      ← Test code generation
├── validator.agent.md      ← Test execution & error classification
├── fixer.agent.md          ← Auto-fix engine
└── telemetry.agent.md      ← Metrics & reporting
```

### Agent File Format

Each agent follows the GitHub Copilot agent specification:

```markdown
---
description: "What the agent does"
name: "Agent Display Name"
tools: ["read", "edit", "search", "execute"]
---

Detailed instructions, input/output schemas, rules, and decision logic.
```

### How to Use in Copilot Chat

Select any agent from the **agents dropdown** in:
- **GitHub.com** — Copilot Chat panel
- **VS Code** — Copilot Chat sidebar
- **JetBrains IDEs** — Copilot Chat tool window

Example prompts after selecting an agent:

```
# Select "Planner Agent" from dropdown, then:
Analyze tests/LoginTest.testcase for Salesforce Lightning migration

# Select "Explorer Agent" from dropdown, then:
Scan https://myorg.lightning.force.com and discover all interactive elements

# Select "Migration Orchestrator" from dropdown, then:
Migrate tests/SmokeTest.testcase to Playwright with base URL https://myorg.my.salesforce.com

# Select "Fixer Agent" from dropdown, then:
Fix the locator errors in output/tests/login-and-create-account.spec.ts

# Select "Telemetry Agent" from dropdown, then:
Generate a migration quality report from the latest run
```

### Agent Tool Permissions

| Agent | `read` | `edit` | `search` | `execute` |
|-------|--------|--------|----------|-----------|
| Orchestrator | x | x | x | x |
| Planner | x | | x | |
| Parser | x | | x | |
| Explorer | x | | x | x |
| Mapping | x | | x | |
| Generator | x | x | x | |
| Validator | x | | x | x |
| Fixer | x | x | x | |
| Telemetry | x | | x | |

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- A Provar project with test cases in XML format
- **GitHub Copilot** subscription (for Copilot agent features)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/praneethpaturu/Provar-migration.git
cd Provar-migration
```

### 2. Install dependencies

```bash
npm install
```

### 3. Install Playwright browsers (required for Explorer and Validator agents)

```bash
npx playwright install chromium
```

### 4. Configure environment variables (optional)

Create a `.env` file in the project root if you want to run tests against a live Salesforce org:

```env
BASE_URL=https://your-org.my.salesforce.com
SF_USERNAME=admin@example.com
SF_PASSWORD=your-password
SF_TOKEN=your-security-token
```

## Usage

### Run a full migration (CLI)

```bash
npx ts-node orchestrator/index.ts <path-to-provar-xml> [options]
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--base-url <url>` | Application base URL | `https://login.salesforce.com` |
| `--output <dir>` | Output directory for generated tests | `./output` |
| `--app-type <type>` | `salesforce`, `custom-web`, or `hybrid` | `salesforce` |
| `--no-explorer` | Skip live UI scanning | Explorer enabled |
| `--no-fixer` | Skip auto-fix for failed tests | Fixer enabled |
| `--no-telemetry` | Skip metrics collection | Telemetry enabled |
| `--max-retries <n>` | Max fix-and-retry attempts | `2` |

**Examples:**

```bash
# Migrate a Provar test with live UI scanning
npx ts-node orchestrator/index.ts ./tests/LoginTest.testcase \
  --base-url https://myorg.lightning.force.com \
  --output ./output

# Migrate without Explorer (offline mode — uses Provar selectors directly)
npx ts-node orchestrator/index.ts ./tests/SmokeTest.testcase \
  --no-explorer \
  --output ./output

# Migrate a non-Salesforce web app
npx ts-node orchestrator/index.ts ./tests/WebApp.xml \
  --app-type custom-web \
  --base-url https://staging.example.com
```

### Run the sample demo

```bash
npx ts-node samples/run-example.ts
```

This runs the full pipeline against the included `samples/sample-provar-test.xml` (Salesforce login + account creation) and prints a results summary:

```
┌─────────────────────────────────────────────────────┐
│                    RESULTS                          │
├─────────────────────────────────────────────────────┤
│  Status:            PARTIAL                         │
│  Duration:          16.0s                           │
│  Strategy:          hybrid                          │
│  Complexity:        medium                          │
│  Tests Parsed:      2                               │
│  Steps Parsed:      21                              │
│  Files Generated:   5                               │
│  Mapping Confidence: 32%                            │
├─────────────────────────────────────────────────────┤
│  Tests Passed:      0                               │
│  Tests Failed:      2                               │
│  Auto-Fixed:        1                               │
├─────────────────────────────────────────────────────┤
│  Success Rate:      50%                             │
│  Avg Execution:     6.0s                            │
│  Coverage:          8%                              │
└─────────────────────────────────────────────────────┘
```

> **Note:** Tests fail at validation without a live Salesforce org. With Explorer enabled against a real org, mapping confidence and success rate increase significantly.

## Provar Project Structure

The system understands the standard Provar project layout:

```
Oliva [SF-P4G-Provar-Reg-OLVA]/
├── .licenses/
├── .settings/
├── .smtp/
├── ANT/                 ← Build scripts
├── bin/
├── META-INF/
│   └── MANIFEST.MF
├── src/
│   └── pageobjects/    ← Provar Page Object definitions
├── templates/           ← Test templates
├── tests/               ← Test cases (XML) — primary input
├── .classpath
├── .gitignore
├── .project
├── .secrets/            ← Credentials / connection configs
├── .testproject
├── build.properties
└── nitroXConfig.json    ← NitroX configuration
```

Point the orchestrator at any `.testcase` or `.xml` file from the `tests/` directory.

## Generated Output

After a migration run, the `output/` directory contains:

```
output/
├── tests/
│   ├── login-and-create-account.spec.ts
│   └── search-and-validate-contact.spec.ts
├── pages/
│   ├── accounts-page.page.ts
│   └── account-form.page.ts
└── playwright.config.ts
```

- **Test files** — Playwright `test.describe` / `test` blocks with locator actions
- **Page Objects** — Reusable page classes with locator getters
- **Config** — Playwright configuration with Salesforce-optimized timeouts

### Running generated tests

```bash
cd output
npm init -y
npm install @playwright/test
npx playwright install chromium
npx playwright test
```

## Pipeline Flow

### Step-by-step execution

| Step | Agent | What it does |
|------|-------|-------------|
| 1 | **Planner** | Analyzes XML complexity, decides strategy (ui/api/hybrid), identifies risks |
| 2 | **Parser** | Parses Provar XML into normalized steps (click, type, assert, navigate...) |
| 3 | **Explorer** | Launches Playwright browser, scans pages, discovers elements with ARIA roles |
| 4 | **Mapping** | Matches parsed steps to discovered UI elements with confidence scoring |
| 5 | **Generator** | Creates `.spec.ts` tests, Page Objects, and `playwright.config.ts` |
| 6 | **Validator** | Executes tests via Playwright, classifies errors, detects flaky tests |
| 7 | **Fixer** | Auto-fixes failures (replaces selectors, adds waits, relaxes assertions) |
| 8 | **Telemetry** | Calculates success rate, failure patterns, coverage, persists metrics |

### Data flow between agents

```
Provar XML ──→ [Planner] ──→ strategy, risks, recommendations
                                │
Provar XML ──→ [Parser]  ──→ parsed test cases + steps
                                │
Base URL   ──→ [Explorer] ──→ UI element map + locators
                                │
            ┌───────────────────┘
            ↓
         [Mapping] ──→ mapped steps with Playwright actions + confidence
            ↓
         [Generator] ──→ .spec.ts files + Page Objects + config
            ↓
         [Validator] ──→ pass/fail results + error classification
            ↓
         [Fixer] ──→ fixed test code (re-validated)
            ↓
         [Telemetry] ──→ metrics JSON report
```

## Telemetry & Reports

After each run, telemetry is saved to `metrics/`:

```json
{
  "runId": "a1b2c3d4-...",
  "totalTests": 12,
  "passed": 9,
  "failed": 3,
  "autoFixed": 2,
  "flaky": 1,
  "successRate": 75,
  "avgExecutionTime": "3.2s",
  "migrationCoverage": 85,
  "strategyUsed": "hybrid",
  "agentMetrics": [
    { "agentName": "planner", "executionTime": 120, "successRate": 100 },
    { "agentName": "validator", "executionTime": 38400, "successRate": 75 },
    { "agentName": "fixer", "executionTime": 1200, "successRate": 67 }
  ],
  "failurePatterns": [
    { "pattern": "locator", "count": 2, "suggestedFix": "Update selectors to use getByRole" }
  ],
  "duration": "45.2s"
}
```

Historical run data is tracked in `metrics/history.json` for trend analysis (last 100 runs).

## Locator Strategy

The system prioritizes resilient selectors in this order:

| Priority | Strategy | Example |
|----------|----------|---------|
| 1 | `getByRole()` | `page.getByRole('button', { name: 'Log In' })` |
| 2 | `getByLabel()` | `page.getByLabel('Username')` |
| 3 | `getByTestId()` | `page.getByTestId('submit-btn')` |
| 4 | `getByPlaceholder()` | `page.getByPlaceholder('Search...')` |
| 5 | `getByText()` | `page.getByText('Welcome')` |
| 6 | CSS selector | `page.locator('#accountName')` |
| 7 | XPath | Avoided — last resort only |

## Salesforce Lightning Support

- Detects Lightning Web Components (`lightning-*` elements) and Aura components (`[data-aura-rendered-by]`)
- Handles Shadow DOM boundaries
- Discovers and scans iframes (common in Salesforce Classic → Lightning)
- Waits for `.slds-spinner_container` to disappear before scanning
- Uses `networkidle` wait strategy for Lightning page loads
- Configures extended timeouts: 15s action, 30s navigation

## Auto-Fix Capabilities

The Fixer Agent handles these failure types automatically:

| Error Type | Fix Applied |
|------------|------------|
| Broken selector | Replace with UI map alternative (getByRole preferred) |
| Timeout | Add `waitForLoadState('networkidle')`, increase inline timeouts |
| Assertion mismatch | Relax `toHaveText` → `toContainText`, use soft assertions |
| Navigation error | Add `waitUntil: 'networkidle'`, increase navigation timeout |
| Iframe error | Add `page.frameLocator()` wrapper |

## Logs

Each agent writes to its own log file in `logs/`:

```
logs/
├── orchestrator.log
├── planner-agent.log
├── parser-agent.log
├── explorer-agent.log
├── mapping-agent.log
├── generator-agent.log
├── validator-agent.log
├── fixer-agent.log
└── telemetry-agent.log
```

## Project Structure

```
Provar-migration/
├── .github/
│   └── agents/                  ← GitHub Copilot Agent definitions
│       ├── orchestrator.agent.md
│       ├── planner.agent.md
│       ├── parser.agent.md
│       ├── explorer.agent.md
│       ├── mapping.agent.md
│       ├── generator.agent.md
│       ├── validator.agent.md
│       ├── fixer.agent.md
│       └── telemetry.agent.md
├── agents/                      ← Agent implementations (TypeScript)
│   ├── planner.ts
│   ├── parser.ts
│   ├── explorer.ts
│   ├── mapping.ts
│   ├── generator.ts
│   ├── validator.ts
│   ├── fixer.ts
│   ├── telemetry.ts
│   └── index.ts
├── orchestrator/
│   └── index.ts                 ← Pipeline controller & CLI
├── types/
│   └── index.ts                 ← All TypeScript interfaces (40+ types)
├── utils/
│   ├── logger.ts                ← Per-agent file logger
│   └── provar-reader.ts         ← Provar project structure reader
├── samples/
│   ├── sample-provar-test.xml   ← Example Provar test (Salesforce)
│   ├── run-example.ts           ← Demo execution script
│   └── sample-telemetry-output.json
├── logs/                        ← Agent log files (gitignored)
├── metrics/                     ← Telemetry reports (gitignored)
├── output/                      ← Generated Playwright tests (gitignored)
├── package.json
├── tsconfig.json
└── .gitignore
```

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Browser automation:** Playwright
- **XML parsing:** fast-xml-parser
- **Logging:** Custom per-agent file logger
- **Agent framework:** GitHub Copilot Agents (`.agent.md`)
- **Output format:** Playwright Test (`@playwright/test`)

## License

MIT
