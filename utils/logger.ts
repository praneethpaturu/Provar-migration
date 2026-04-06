import * as fs from "fs";
import * as path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_DIR = path.resolve(__dirname, "..", "logs");

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class AgentLogger {
  private agentName: string;
  private logFile: string;
  private minLevel: LogLevel;

  constructor(agentName: string, minLevel: LogLevel = "info") {
    this.agentName = agentName;
    this.minLevel = minLevel;

    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    this.logFile = path.join(LOG_DIR, `${agentName}.log`);
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  private format(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const base = `[${timestamp}] [${level.toUpperCase()}] [${this.agentName}] ${message}`;
    return data ? `${base} ${JSON.stringify(data)}` : base;
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.format(level, message, data);
    console.log(formatted);
    fs.appendFileSync(this.logFile, formatted + "\n");
  }

  debug(message: string, data?: unknown): void {
    this.write("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.write("error", message, data);
  }

  startTimer(): () => number {
    const start = Date.now();
    return () => Date.now() - start;
  }
}

export function createLogger(agentName: string): AgentLogger {
  return new AgentLogger(agentName);
}
