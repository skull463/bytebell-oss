export type CheckFailure = {
  name: string;
  rule?: string;
  files: Array<{ path: string; detail?: string }>;
  fix: string;
};

export const RED = "\x1b[31m";
export const YELLOW = "\x1b[33m";
export const GREEN = "\x1b[32m";
export const DIM = "\x1b[2m";
export const BOLD = "\x1b[1m";
export const RESET = "\x1b[0m";

export function fail(f: CheckFailure): never {
  console.error("");
  const ruleSuffix = f.rule ? `  ${DIM}(${f.rule})${RESET}` : "";
  console.error(`${RED}${BOLD}✗ ${f.name}${RESET}${ruleSuffix}`);
  console.error("");
  for (const item of f.files) {
    const detail = item.detail ? `  ${DIM}${item.detail}${RESET}` : "";
    console.error(`    ${item.path}${detail}`);
  }
  console.error("");
  console.error(`  ${YELLOW}fix:${RESET} ${f.fix}`);
  console.error("");
  process.exit(1);
}

export function ok(name: string): void {
  console.log(`  ${GREEN}✓${RESET} ${name}`);
}

export function warn(msg: string, hint?: string): void {
  console.warn(`  ${YELLOW}⚠${RESET} ${msg}`);
  if (hint) {
    console.warn(`    ${DIM}${hint}${RESET}`);
  }
}
