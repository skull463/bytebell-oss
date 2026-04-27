#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { BOLD, DIM, GREEN, RED, RESET, YELLOW } from "./lib/output.ts";

type StepResult = {
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
};

function runStep(name: string, cmd: string, args: string[]): StepResult {
  console.log("");
  console.log(`${BOLD}▶ ${name}${RESET} ${DIM}(${cmd} ${args.join(" ")})${RESET}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status === 0) {
    return { name, status: "pass" };
  }
  return { name, status: "fail", detail: `exit ${r.status ?? "?"}` };
}

function runOptional(name: string, reason: string): StepResult {
  console.log("");
  console.log(`${BOLD}▶ ${name}${RESET}  ${DIM}— ${reason}${RESET}`);
  return { name, status: "skip", detail: reason };
}

function summary(results: StepResult[]): void {
  console.log("");
  console.log(`${BOLD}Pre-push summary${RESET}`);
  for (const r of results) {
    if (r.status === "pass") {
      console.log(`  ${GREEN}✓${RESET} ${r.name}`);
    } else if (r.status === "skip") {
      console.log(`  ${YELLOW}─${RESET} ${r.name}  ${DIM}${r.detail ?? ""}${RESET}`);
    } else {
      console.log(`  ${RED}✗${RESET} ${r.name}  ${DIM}${r.detail ?? ""}${RESET}`);
    }
  }
}

function main(): void {
  const results: StepResult[] = [];
  results.push(runStep("typecheck", "bun", ["run", "typecheck"]));
  results.push(runStep("lint (full repo)", "bun", ["run", "lint"]));
  results.push(runStep("format check (full repo)", "bun", ["run", "format:check"]));
  results.push(runOptional("tests", "no test runner configured yet"));
  summary(results);
  const failed = results.filter((r) => r.status === "fail");
  if (failed.length > 0) {
    console.log("");
    console.log(`${RED}${BOLD}✗ pre-push failed${RESET} — fix the ${failed.length} failing step(s) above.`);
    process.exit(1);
  }
  console.log("");
  console.log(`${GREEN}${BOLD}✓ pre-push passed${RESET}`);
}

main();
