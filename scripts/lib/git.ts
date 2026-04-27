import { spawnSync } from "node:child_process";

const TEXT_EXTS = new Set([
  "ts",
  "tsx",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "json",
  "md",
  "yml",
  "yaml",
  "txt",
  "env",
  "example",
  "toml",
  "html",
  "css",
  "scss",
  "sh",
  "sql",
  "graphql",
  "gql",
  "xml",
  "svg",
]);

export function git(args: string[]): string {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r.stdout;
}

export function stagedFiles(): string[] {
  const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]);
  return out.split("\0").filter(Boolean);
}

export function stagedBlobSize(path: string): number {
  const r = spawnSync("git", ["cat-file", "-s", `:${path}`], { encoding: "utf8" });
  if (r.status !== 0) {
    return 0;
  }
  return parseInt(r.stdout.trim(), 10) || 0;
}

export function stagedBlobContent(path: string): string | null {
  const r = spawnSync("git", ["show", `:${path}`], { encoding: "utf8" });
  if (r.status !== 0) {
    return null;
  }
  return r.stdout;
}

export function isInIndex(path: string): boolean {
  const r = spawnSync("git", ["ls-files", "--cached", "--error-unmatch", path], { encoding: "utf8" });
  return r.status === 0;
}

export function isTextLikely(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXTS.has(ext)) {
    return true;
  }
  return base === ".gitignore" || base === ".gitattributes" || base.endsWith("rc");
}

export function commandExists(cmd: string): boolean {
  const r = spawnSync("which", [cmd], { encoding: "utf8" });
  return r.status === 0;
}
