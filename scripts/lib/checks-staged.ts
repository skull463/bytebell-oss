import { fail } from "./output.ts";
import { isTextLikely, stagedBlobContent, stagedBlobSize } from "./git.ts";

const MAX_FILE_BYTES = 1024 * 1024;
const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

export function checkLockfiles(files: string[]): void {
  const offenders = files.filter((p) => LOCKFILES.has(p.split("/").pop() ?? ""));
  if (offenders.length === 0) {
    return;
  }
  fail({
    name: "Foreign lockfile staged",
    rule: "Rule of Package Manager — Bun only",
    files: offenders.map((p) => ({ path: p })),
    fix: "Remove the lockfile (only bun.lock is allowed) and re-stage.",
  });
}

export function checkLargeFiles(files: string[]): void {
  const offenders: Array<{ path: string; detail?: string }> = [];
  for (const p of files) {
    const size = stagedBlobSize(p);
    if (size > MAX_FILE_BYTES) {
      offenders.push({ path: p, detail: `${(size / 1024 / 1024).toFixed(2)} MB` });
    }
  }
  if (offenders.length === 0) {
    return;
  }
  fail({
    name: "Large file blocker (>1 MB)",
    files: offenders,
    fix: "Files >1MB are likely binaries or dumps. Use Git LFS or exclude from the commit.",
  });
}

export function checkMergeMarkers(files: string[]): void {
  const offenders: Array<{ path: string; detail?: string }> = [];
  for (const p of files) {
    if (!isTextLikely(p)) {
      continue;
    }
    const content = stagedBlobContent(p);
    if (content === null) {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln === undefined) {
        continue;
      }
      if (ln.startsWith("<<<<<<< ") || ln.startsWith(">>>>>>> ")) {
        offenders.push({ path: p, detail: `line ${i + 1}` });
        break;
      }
    }
  }
  if (offenders.length === 0) {
    return;
  }
  fail({
    name: "Merge conflict markers",
    files: offenders,
    fix: "Resolve the conflict and remove the marker lines before committing.",
  });
}

export function checkWhitespaceAndEof(files: string[]): void {
  const offenders: Array<{ path: string; detail?: string }> = [];
  for (const p of files) {
    if (!isTextLikely(p)) {
      continue;
    }
    const content = stagedBlobContent(p);
    if (content === null || content.length === 0) {
      continue;
    }
    const lines = content.split("\n");
    let pushed = false;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln === undefined) {
        continue;
      }
      if (/[ \t]+$/.test(ln)) {
        offenders.push({ path: p, detail: `trailing whitespace at line ${i + 1}` });
        pushed = true;
        break;
      }
    }
    if (!pushed && !content.endsWith("\n")) {
      offenders.push({ path: p, detail: "missing newline at EOF" });
    }
  }
  if (offenders.length === 0) {
    return;
  }
  fail({
    name: "Whitespace / EOF newline",
    files: offenders,
    fix: "Run `bun run format` to auto-fix, then re-stage.",
  });
}
