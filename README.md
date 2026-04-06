# Provar → Playwright Migration System

A multi-agent system built entirely on **GitHub Copilot Agents** that automatically converts Provar QA test cases (XML) into production-ready Playwright test scripts, with built-in Salesforce Lightning support.

All migration logic runs through GitHub Copilot Agents — no CLI or Node.js runtime required. Just select an agent in Copilot Chat and point it at your local Provar project.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator Agent                        │
│         (coordinates all agents in sequence)                 │
├─────────┬────────┬──────────┬─────────┬───────────┬─────────┤
│ Planner → Parser → Explorer → Mapping → Generator → Validator│
│                                                    ↓        │
│                                              Fixer → Telemetry│
└─────────────────────────────────────────────────────────────┘
```

All agents are defined as `.agent.md` files in `.github/agents/` and run directly in GitHub Copilot Chat.

## Agents

| Agent | File | Role | Tools |
|-------|------|------|-------|
| **Orchestrator** | `orchestrator.agent.md` | Runs the full 8-step pipeline end-to-end | read, edit, search, execute |
| **Planner** | `planner.agent.md` | Analyzes Provar project, decides migration strategy | read, search |
| **Parser** | `parser.agent.md` | Reads Provar XML test cases, extracts normalized steps | read, search |
| **Explorer** | `explorer.agent.md` | Scans live UI with Playwright, discovers elements and locators | read, edit, search, execute |
| **Mapping** | `mapping.agent.md` | Matches parsed steps to UI elements with confidence scoring | read, search |
| **Generator** | `generator.agent.md` | Creates `.spec.ts` tests, Page Objects, and Playwright config | read, edit, search |
| **Validator** | `validator.agent.md` | Executes tests, classifies errors, detects flaky tests | read, search, execute |
| **Fixer** | `fixer.agent.md` | Auto-fixes broken selectors, timeouts, assertions | read, edit, search |
| **Telemetry** | `telemetry.agent.md` | Calculates metrics, failure patterns, saves reports | read, edit, search |

## How to Use

### Prerequisites

- **GitHub Copilot** subscription with agent support
- A **local Provar project** on disk with test cases in `tests/`

### Step 1: Clone this repo

```bash
git clone https://github.com/praneethpaturu/Provar-migration.git
```

### Step 2: Open in your IDE (VS Code, JetBrains, or GitHub.com)

The `.github/agents/` directory is automatically detected by GitHub Copilot.

### Step 3: Select an agent and start

Open **Copilot Chat** and select an agent from the agents dropdown.

## Connecting to Your Provar Project

Every agent reads directly from your **local Provar project folder** on disk. Just tell the agent the path:

```
Migrate my Provar project at /Users/apple/Oliva
```

### What the agents read automatically

| Provar Path | What the agents do with it |
|---|---|
| `tests/*.testcase` | Auto-discover all test XML files and migrate each one |
| `src/pageobjects/*.page` | Read Provar page objects for better element mapping |
| `nitroXConfig.json` | Extract base URL and environment settings |
| `templates/` | Discover test templates for reusable flow detection |
| `.secrets/` | Read connection config (credentials) |

### Expected Provar project layout

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
│   └── pageobjects/    ← Provar Page Object definitions (auto-read)
├── templates/           ← Test templates (auto-read)
├── tests/               ← Test cases (XML) — primary input (auto-discovered)
├── .classpath
├── .gitignore
├── .project
├── .secrets/            ← Credentials / connection configs (auto-read)
├── .testproject
├── build.properties
└── nitroXConfig.json    ← NitroX configuration (auto-read)
```

## Using the Agents

### Full migration (Orchestrator Agent)

Select **"Migration Orchestrator"** from the agents dropdown, then:

```
Migrate my Provar project at /Users/apple/Oliva to Playwright.
The Salesforce org URL is https://myorg.lightning.force.com
Output to /Users/apple/Oliva/playwright-output
```

The Orchestrator will:
1. Connect to your Provar project and discover all test files
2. Analyze complexity and decide strategy (Planner)
3. Parse all test XML files (Parser)
4. Optionally scan the live UI (Explorer)
5. Map Provar steps to Playwright locators (Mapping)
6. Generate `.spec.ts` files, Page Objects, and config (Generator)
7. Run the tests (Validator)
8. Auto-fix failures (Fixer)
9. Report metrics (Telemetry)

### Individual agents

You can also use agents individually for specific tasks:

**Planner Agent:**
```
Analyze the Provar project at /Users/apple/Oliva and recommend a migration strategy
```

**Parser Agent:**
```
Parse the test file at /Users/apple/Oliva/tests/LoginTest.testcase and show me the steps
```

**Explorer Agent:**
```
Scan https://myorg.lightning.force.com and discover all interactive elements with best locators
```

**Mapping Agent:**
```
Map these Provar test steps to Playwright locators:
- Click //input[@id='Login']
- Set //input[@name='username'] value="admin"
- Assert //div[@class='toast'] text contains "Success"
```

**Generator Agent:**
```
Generate Playwright test files for the LoginAndCreateAccount test case. Use Page Object Model.
Output to /Users/apple/Oliva/playwright-output
```

**Validator Agent:**
```
Run the Playwright tests in /Users/apple/Oliva/playwright-output and report results
```

**Fixer Agent:**
```
Fix the locator errors in /Users/apple/Oliva/playwright-output/tests/login-test.spec.ts
The error was: locator('#searchBox') not found
```

**Telemetry Agent:**
```
Generate a migration quality report. We had 12 tests: 9 passed, 3 failed, 2 auto-fixed, 1 flaky
```

## Pipeline Flow

### Step-by-step execution

| Step | Agent | What it does |
|------|-------|-------------|
| 1 | **Planner** | Reads Provar project, analyzes complexity, decides strategy (ui/api/hybrid) |
| 2 | **Parser** | Reads test XML from `tests/`, extracts normalized steps |
| 3 | **Explorer** | Launches Playwright, scans live pages, discovers elements with ARIA roles |
| 4 | **Mapping** | Matches parsed steps to discovered UI elements with confidence scoring |
| 5 | **Generator** | Creates `.spec.ts` tests, Page Objects, and `playwright.config.ts` |
| 6 | **Validator** | Runs tests via Playwright, classifies errors, detects flaky tests |
| 7 | **Fixer** | Auto-fixes failures (replaces selectors, adds waits, relaxes assertions) |
| 8 | **Telemetry** | Calculates success rate, failure patterns, saves JSON report |

### Data flow

```
┌──────────────────────────────────────────┐
│         Local Provar Project             │
│  tests/  src/pageobjects/  nitroXConfig  │
└────────────────┬─────────────────────────┘
                 │ (filesystem read by agents)
                 ↓
         ┌──────────────┐
         │ Orchestrator │──→ coordinates all agents
         └──────┬───────┘
                │
   ┌────────────┼────────────┐
   ↓            ↓            ↓
[Planner]   [Parser]    [Explorer]
 strategy    parsed      UI element
 risks       steps       map + locators
   └────────────┼────────────┘
                ↓
           [Mapping] ──→ matched steps with Playwright actions
                ↓
           [Generator] ──→ .spec.ts + Page Objects + config
                ↓
           [Validator] ──→ pass/fail results + error classification
                ↓
           [Fixer] ──→ fixed test code (re-validated)
                ↓
           [Telemetry] ──→ metrics JSON report → metrics/
```

## Generated Output

After migration, the output directory contains:

```
output/
├── tests/
│   ├── login-and-create-account.spec.ts
│   └── search-and-validate-contact.spec.ts
├── pages/
│   ├── login-page.page.ts
│   ├── accounts-page.page.ts
│   └── account-form.page.ts
├── playwright.config.ts
└── .env.example
```

### Running generated tests manually

```bash
cd output
npm init -y
npm install @playwright/test
npx playwright install chromium
cp .env.example .env  # fill in your credentials
npx playwright test
```

## Locator Strategy

All agents follow this strict priority order:

| Priority | Strategy | Example |
|----------|----------|---------|
| 1 | `getByRole()` | `page.getByRole('button', { name: 'Log In' })` |
| 2 | `getByLabel()` | `page.getByLabel('Username')` |
| 3 | `getByTestId()` | `page.getByTestId('submit-btn')` |
| 4 | `getByPlaceholder()` | `page.getByPlaceholder('Search...')` |
| 5 | `getByText()` | `page.getByText('Welcome')` |
| 6 | CSS selector | `page.locator('#accountName')` |
| 7 | XPath | **NEVER** — avoided unless absolutely no alternative |

## Salesforce Lightning Support

All agents are Salesforce-aware:

- Detect Lightning Web Components (`lightning-*` elements) and Aura components (`[data-aura-rendered-by]`)
- Handle Shadow DOM boundaries
- Discover and scan iframes with `page.frameLocator()`
- Wait for `.slds-spinner_container` to disappear before scanning
- Use `networkidle` wait strategy for Lightning page loads
- Extended timeouts: 15s action, 30s navigation

## Auto-Fix Capabilities

The Fixer Agent handles these failure types:

| Error Type | Fix Applied |
|------------|------------|
| Broken selector | Replace with `getByRole`/`getByLabel` from UI map |
| Timeout | Add `waitForLoadState('networkidle')`, increase inline timeouts |
| Assertion mismatch | Relax `toHaveText` → `toContainText`, use soft assertions |
| Navigation error | Add `waitUntil: 'networkidle'`, increase navigation timeout |
| Iframe error | Wrap with `page.frameLocator()` |

## Telemetry & Reports

The Telemetry Agent saves JSON reports to `metrics/`:

```json
{
  "totalTests": 12,
  "passed": 9,
  "failed": 3,
  "autoFixed": 2,
  "flaky": 1,
  "successRate": 75,
  "avgExecutionTime": "3.2s",
  "migrationCoverage": 85,
  "failurePatterns": [
    { "pattern": "locator", "count": 2, "suggestedFix": "Update selectors to getByRole" }
  ]
}
```

## Agent File Format

Each agent in `.github/agents/` uses the standard GitHub Copilot agent specification:

```markdown
---
description: "What the agent does"
name: "Agent Display Name"
tools: ["read", "edit", "search", "execute"]
---

Detailed instructions for the agent...
```

## Project Structure

```
Provar-migration/
├── .github/
│   └── agents/                  ← GitHub Copilot Agent definitions
│       ├── orchestrator.agent.md    (read, edit, search, execute)
│       ├── planner.agent.md         (read, search)
│       ├── parser.agent.md          (read, search)
│       ├── explorer.agent.md        (read, edit, search, execute)
│       ├── mapping.agent.md         (read, search)
│       ├── generator.agent.md       (read, edit, search)
│       ├── validator.agent.md       (read, search, execute)
│       ├── fixer.agent.md           (read, edit, search)
│       └── telemetry.agent.md       (read, edit, search)
├── samples/
│   ├── tests/
│   │   └── LoginAndCreateAccount.testcase
│   ├── sample-provar-test.xml
│   └── sample-telemetry-output.json
├── metrics/                     ← Telemetry reports (generated)
└── README.md
```

## License

MIT
