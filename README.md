# Provar → Playwright Migration System

A multi-agent orchestration system that automatically converts Provar QA test cases (XML) into production-ready Playwright test scripts, with built-in Salesforce Lightning support.

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

| Agent | Role |
|-------|------|
| **Planner** | Decides migration strategy (ui-based / api-based / hybrid) |
| **Parser** | Extracts steps from Provar XML test cases |
| **Explorer** | Scans live UI with Playwright to discover elements and locators |
| **Mapping** | Matches parsed steps to discovered UI elements |
| **Generator** | Produces `.spec.ts` test files, Page Objects, and Playwright config |
| **Validator** | Runs generated tests and classifies errors |
| **Fixer** | Auto-fixes failures (broken selectors, timeouts, assertions) |
| **Telemetry** | Tracks success rates, failure patterns, and migration coverage |

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- A Provar project with test cases in XML format

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

### Run a full migration

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

This runs the full pipeline against the included `samples/sample-provar-test.xml` (Salesforce login + account creation) and prints a results summary.

## Provar Project Structure

The system understands the standard Provar project layout:

```
Oliva [SF-P4G-Provar-Reg-OLVA]/
├── tests/               ← Test cases (XML) — primary input
├── src/pageobjects/     ← Provar Page Objects
├── templates/           ← Test templates
├── .secrets/            ← Credentials / connection configs
├── ANT/                 ← Build scripts
├── nitroXConfig.json    ← NitroX configuration
└── build.properties
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

## Telemetry & Reports

After each run, telemetry is saved to `metrics/`:

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
    { "pattern": "locator", "count": 2, "suggestedFix": "..." }
  ]
}
```

Historical run data is tracked in `metrics/history.json` for trend analysis.

## Locator Strategy

The system prioritizes resilient selectors in this order:

1. `getByRole()` — ARIA role + accessible name (preferred)
2. `getByLabel()` — associated `<label>` text
3. `getByTestId()` — `data-testid` attribute
4. `getByPlaceholder()` — placeholder text
5. `getByText()` — visible text content
6. CSS selector — fallback
7. XPath — last resort (avoided when possible)

## Salesforce Lightning Support

- Detects Lightning Web Components and Aura components
- Handles Shadow DOM boundaries
- Discovers and scans iframes (common in Salesforce Classic → Lightning)
- Uses `networkidle` wait strategy for Lightning page loads
- Configures extended timeouts for Salesforce DOM stabilization

## Logs

Each agent writes to its own log file in `logs/`:

```
logs/
├── planner-agent.log
├── parser-agent.log
├── explorer-agent.log
├── mapping-agent.log
├── generator-agent.log
├── validator-agent.log
├── fixer-agent.log
├── telemetry-agent.log
└── orchestrator.log
```

## GitHub Copilot Integration

All agents are defined in `.github/agents.md` for Copilot agent invocation:

```
@planner   Analyze tests/LoginTest.testcase for migration
@explorer  Scan https://myorg.lightning.force.com and discover elements
@orchestrate  Migrate tests/SmokeTest.testcase --base-url https://myorg.my.salesforce.com
```

## Project Structure

```
Provar-migration/
├── agents/
│   ├── planner.ts        — Strategy & complexity analysis
│   ├── parser.ts         — Provar XML parsing
│   ├── explorer.ts       — Live UI discovery (Playwright)
│   ├── mapping.ts        — Step-to-locator mapping
│   ├── generator.ts      — Test code generation
│   ├── validator.ts      — Test execution & error classification
│   ├── fixer.ts          — Auto-fix engine
│   ├── telemetry.ts      — Metrics & reporting
│   └── index.ts          — Barrel exports
├── orchestrator/
│   └── index.ts          — Pipeline controller & CLI
├── types/
│   └── index.ts          — All TypeScript interfaces
├── utils/
│   ├── logger.ts         — Per-agent file logger
│   └── provar-reader.ts  — Provar project structure reader
├── samples/
│   ├── sample-provar-test.xml
│   ├── run-example.ts
│   └── sample-telemetry-output.json
├── .github/
│   └── agents.md         — Copilot agent definitions
├── package.json
└── tsconfig.json
```

## License

MIT
