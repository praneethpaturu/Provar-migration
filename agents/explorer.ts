import { chromium, Browser, Page, Frame } from "playwright";
import {
  ExplorerInput,
  ExplorerOutput,
  DiscoveredPage,
  DiscoveredElement,
  IframeInfo,
  LocatorStrategy,
  Credentials,
} from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("explorer-agent");

export class ExplorerAgent {
  private browser: Browser | null = null;

  async execute(input: ExplorerInput): Promise<ExplorerOutput> {
    const timer = logger.startTimer();
    logger.info("Starting UI exploration", { baseUrl: input.baseUrl, strategy: input.strategy });

    const pages: DiscoveredPage[] = [];
    const warnings: string[] = [];

    try {
      this.browser = await chromium.launch({ headless: true });
      const context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true,
      });
      const page = await context.newPage();

      // Navigate to base URL
      await page.goto(input.baseUrl, { waitUntil: "networkidle", timeout: 30000 });

      // Handle login if credentials provided
      if (input.credentials) {
        await this.handleLogin(page, input.credentials);
      }

      // Scan specified pages or discover from current page
      const urlsToScan = input.pagesToScan ?? [input.baseUrl];

      for (const url of urlsToScan) {
        try {
          if (url !== input.baseUrl) {
            await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
          }

          const discovered = await this.scanPage(page, url);
          pages.push(discovered);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to scan ${url}: ${msg}`);
          logger.warn(`Failed to scan page`, { url, error: msg });
        }
      }
    } finally {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    }

    const locatorBreakdown = this.calculateLocatorBreakdown(pages);
    const totalElements = pages.reduce((sum, p) => sum + p.elements.length, 0);

    const output: ExplorerOutput = {
      pages,
      totalElements,
      locatorBreakdown,
      warnings,
    };

    logger.info("Exploration complete", {
      pagesScanned: pages.length,
      totalElements,
      duration: `${timer()}ms`,
    });

    return output;
  }

  private async handleLogin(page: Page, credentials: Credentials): Promise<void> {
    logger.info("Attempting login");

    // Try common Salesforce login patterns first
    const usernameSelectors = [
      'input[name="username"]',
      "#username",
      'input[type="email"]',
      'input[placeholder*="username" i]',
      'input[placeholder*="email" i]',
    ];

    const passwordSelectors = [
      'input[name="pw"]',
      'input[name="password"]',
      "#password",
      'input[type="password"]',
    ];

    const loginButtonSelectors = [
      'input[name="Login"]',
      '#Login',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Log In")',
      'button:has-text("Login")',
    ];

    for (const sel of usernameSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.fill(credentials.username);
        break;
      }
    }

    for (const sel of passwordSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.fill(credentials.password);
        break;
      }
    }

    for (const sel of loginButtonSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click();
        break;
      }
    }

    // Wait for navigation after login
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {
      logger.warn("Timeout waiting for post-login navigation");
    });
  }

  private async scanPage(page: Page, url: string): Promise<DiscoveredPage> {
    const pageName = this.derivePageName(url);
    logger.info(`Scanning page: ${pageName}`, { url });

    // Wait for Salesforce Lightning to stabilize
    await this.waitForDynamicContent(page);

    const elements = await this.discoverElements(page);
    const iframes = await this.discoverIframes(page);
    const dynamicRegions = await this.detectDynamicRegions(page);

    // Also scan inside iframes
    for (const iframe of iframes) {
      try {
        const iframeElements = await this.discoverElementsInFrame(page, iframe.selector);
        for (const el of iframeElements) {
          el.withinIframe = iframe.selector;
        }
        elements.push(...iframeElements);
      } catch (err) {
        logger.warn(`Could not scan iframe: ${iframe.selector}`);
      }
    }

    return {
      name: pageName,
      url,
      elements,
      iframes,
      dynamicRegions,
    };
  }

  private async discoverElements(page: Page): Promise<DiscoveredElement[]> {
    return page.evaluate(() => {
      const results: Array<{
        role: string | null;
        name: string | null;
        label: string | null;
        testId: string | null;
        tagName: string;
        locatorStrategy: string;
        locator: string;
        isInteractive: boolean;
      }> = [];

      const interactiveTags = new Set([
        "A", "BUTTON", "INPUT", "SELECT", "TEXTAREA",
        "DETAILS", "SUMMARY",
      ]);

      const interactiveRoles = new Set([
        "button", "link", "textbox", "checkbox", "radio",
        "combobox", "listbox", "menuitem", "tab", "switch",
        "searchbox", "slider", "spinbutton",
      ]);

      const allElements = document.querySelectorAll(
        "a, button, input, select, textarea, [role], [data-testid], [aria-label]"
      );

      for (const el of allElements) {
        const htmlEl = el as HTMLElement;
        const role = el.getAttribute("role") ?? null;
        const ariaLabel = el.getAttribute("aria-label") ?? null;
        const testId = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? null;
        const tagName = el.tagName;
        const name = ariaLabel
          ?? el.getAttribute("name")
          ?? el.getAttribute("placeholder")
          ?? htmlEl.innerText?.trim().substring(0, 50)
          ?? null;

        // Determine label from associated <label>
        let label: string | null = null;
        if (el.id) {
          const labelEl = document.querySelector(`label[for="${el.id}"]`);
          if (labelEl) label = labelEl.textContent?.trim() ?? null;
        }

        const isInteractive =
          interactiveTags.has(tagName) ||
          (role !== null && interactiveRoles.has(role)) ||
          el.getAttribute("tabindex") !== null;

        // Determine best locator strategy (preference order)
        let locatorStrategy = "css";
        let locator = "";

        if (role && name) {
          locatorStrategy = "getByRole";
          locator = `getByRole('${role}', { name: '${name.replace(/'/g, "\\'")}' })`;
        } else if (label) {
          locatorStrategy = "getByLabel";
          locator = `getByLabel('${label.replace(/'/g, "\\'")}')`;
        } else if (testId) {
          locatorStrategy = "getByTestId";
          locator = `getByTestId('${testId}')`;
        } else if (el.getAttribute("placeholder")) {
          locatorStrategy = "getByPlaceholder";
          locator = `getByPlaceholder('${el.getAttribute("placeholder")!.replace(/'/g, "\\'")}')`;
        } else if (name && isInteractive) {
          locatorStrategy = "getByText";
          locator = `getByText('${name.replace(/'/g, "\\'")}')`;
        } else if (el.id) {
          locatorStrategy = "css";
          locator = `#${el.id}`;
        } else {
          locatorStrategy = "css";
          locator = tagName.toLowerCase() + (el.className ? `.${el.className.split(" ")[0]}` : "");
        }

        results.push({
          role,
          name,
          label,
          testId,
          tagName,
          locatorStrategy,
          locator,
          isInteractive,
        });
      }

      return results;
    }) as Promise<DiscoveredElement[]>;
  }

  private async discoverElementsInFrame(page: Page, frameSelector: string): Promise<DiscoveredElement[]> {
    try {
      const frame = page.frameLocator(frameSelector);
      const count = await frame.locator("a, button, input, select, textarea, [role]").count();
      const elements: DiscoveredElement[] = [];

      // Simplified iframe element discovery
      for (let i = 0; i < Math.min(count, 50); i++) {
        const el = frame.locator("a, button, input, select, textarea, [role]").nth(i);
        const tagName = await el.evaluate((e) => e.tagName).catch(() => "UNKNOWN");
        const role = await el.getAttribute("role").catch(() => null);
        const name = await el.getAttribute("aria-label").catch(() => null);

        elements.push({
          role: role ?? undefined,
          name: name ?? undefined,
          tagName,
          locatorStrategy: role ? "getByRole" : "css",
          locator: role && name ? `getByRole('${role}', { name: '${name}' })` : tagName.toLowerCase(),
          isInteractive: true,
          withinIframe: frameSelector,
        } as DiscoveredElement);
      }

      return elements;
    } catch {
      return [];
    }
  }

  private async discoverIframes(page: Page): Promise<IframeInfo[]> {
    return page.evaluate(() => {
      const iframes = document.querySelectorAll("iframe");
      return Array.from(iframes).map((iframe, idx) => ({
        selector: iframe.id
          ? `#${iframe.id}`
          : iframe.name
            ? `iframe[name="${iframe.name}"]`
            : `iframe:nth-of-type(${idx + 1})`,
        name: iframe.name || undefined,
        src: iframe.src || undefined,
      }));
    });
  }

  private async detectDynamicRegions(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const regions: string[] = [];

      // Detect Salesforce Lightning containers
      const lightningContainers = document.querySelectorAll(
        "lightning-card, force-record-layout-section, lightning-tab-bar"
      );
      if (lightningContainers.length > 0) {
        regions.push("salesforce-lightning-components");
      }

      // Detect shadow DOM hosts
      const allEls = document.querySelectorAll("*");
      let shadowHosts = 0;
      for (const el of allEls) {
        if (el.shadowRoot) shadowHosts++;
      }
      if (shadowHosts > 0) {
        regions.push(`shadow-dom-hosts:${shadowHosts}`);
      }

      // Detect Aura components
      const auraEls = document.querySelectorAll("[data-aura-rendered-by]");
      if (auraEls.length > 0) {
        regions.push("aura-components");
      }

      return regions;
    });
  }

  private async waitForDynamicContent(page: Page): Promise<void> {
    // Wait for Salesforce-specific indicators
    try {
      await page.waitForFunction(
        () => {
          // Check if Salesforce Lightning is done loading
          const spinner = document.querySelector(".slds-spinner_container");
          return !spinner || (spinner as HTMLElement).style.display === "none";
        },
        { timeout: 10000 }
      );
    } catch {
      // Not a Salesforce page or spinner not found — continue
    }

    // Additional stability wait
    await page.waitForTimeout(1000);
  }

  private calculateLocatorBreakdown(pages: DiscoveredPage[]): Record<LocatorStrategy, number> {
    const breakdown: Record<LocatorStrategy, number> = {
      getByRole: 0,
      getByLabel: 0,
      getByTestId: 0,
      getByText: 0,
      getByPlaceholder: 0,
      css: 0,
      xpath: 0,
    };

    for (const page of pages) {
      for (const el of page.elements) {
        if (el.locatorStrategy in breakdown) {
          breakdown[el.locatorStrategy]++;
        }
      }
    }

    return breakdown;
  }

  private derivePageName(url: string): string {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/^\/|\/$/g, "");
      if (!path) return "Home";
      return path
        .split("/")
        .pop()!
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    } catch {
      return "Unknown";
    }
  }
}

export async function runExplorerAgent(input: ExplorerInput): Promise<ExplorerOutput> {
  const agent = new ExplorerAgent();
  return agent.execute(input);
}
