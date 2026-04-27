import { spawnSync } from "node:child_process";
import { BOLD, RED, RESET, fail, warn } from "./output.ts";
import { commandExists } from "./git.ts";

export function checkSecrets(): void {
  if (!commandExists("gitleaks")) {
    warn("gitleaks not installed — secrets scan skipped", "install: brew install gitleaks");
    return;
  }
  const r = spawnSync(
    "gitleaks",
    ["protect", "--staged", "--redact", "-v", "--config", ".gitleaks.toml", "--no-banner"],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (r.status !== 0) {
    fail({
      name: "Secrets detected (gitleaks)",
      files: [{ path: "see gitleaks output above" }],
      fix: "Rotate the leaked credential, remove from staged content, and re-stage.",
    });
  }
}

export function runLintStaged(): void {
  const r = spawnSync("bunx", ["lint-staged"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("");
    console.error(`${RED}${BOLD}✗ lint-staged failed${RESET} — fix the errors above and re-stage.`);
    process.exit(r.status ?? 1);
  }
}
