# CLAUDE.md — Bytebell-public

---

## Project Summary

**Bytebell-public** is an open-source, single-tenant local knowledge engine. It ingests GitHub repo into a durable knowledge graph and serves them through an MCP retrieval surface — all from a single Bun-based process running on the user's machine.

It ships two binaries from a single workspace:

- **`bytebell-server`** — a single Express daemon hosting ingestion routes (`/api/v1/...`), the MCP transport (`/mcp`, HTTP + SSE), and BullMQ workers in-process.
- **`bytebell`** — an Ink/React TUI driven by commander subcommands (index, clean, ls, set, models, keys, cost, server, mcp, telemetry, update). Interactive only — no `-p` / headless mode.

The system is **BYO-infra** (the user runs Mongo, Neo4j, Redis), **license-gated** (signed JWT issued at first run; required to boot the server), and ships **always-on telemetry, optionally can be opted out** that streams full request/response logs and anonymous usage stats to ByteBell. Everything is single-tenant with a hardcoded `orgId="local"`. There is no auth, no users, no orgs.

Architecturally, it is a **package-first Bun workspace** under `packages/*` with `@bb/*` naming. See [docs/arch.md](docs/arch.md) for the full PRD.

---

## High-Level Flow

```
TUI / HTTP client → Express (bytebell-server) → BullMQ (in-process) → Phase Pipeline → Graph + Storage
                                              ↘ MCP tools → Neo4j / Mongo retrieval
```

- The CLI never touches Mongo / Neo4j / Redis directly — it only talks HTTP to `bytebell-server`.
- Ingestion is asynchronous, phase-based, resumable. Workers run **inside** the server process; there is no separate worker fleet.
- MCP requests verify the license on every call, then dispatch to the same Mongo + Neo4j the ingestion side wrote.

---

## Tech Stack

- **Runtime**: Bun ≥ 1.1 (required — uses `bun:sqlite` for the cost ledger)
- **Language**: TypeScript (strict, all flags on — see [tsconfig.base.json](tsconfig.base.json))
- **HTTP server**: Express 5
- **TUI**: Ink (React for terminals) + commander
- **Databases**: MongoDB, Neo4j (BYO — user-supplied URIs)
- **Queue**: BullMQ (Redis-backed, in-process workers)
- **Cache + State**: Redis (BYO)
- **Local persistence**: `~/.bytebell/` (config, license, logs, cost ledger SQLite)
- **LLM Provider**: **OpenRouter only**
- **AST**: Tree-sitter
- **Logging**: Winston + telemetry transport
- **Secret storage**: OS keychain via `keytar`, fallback to passphrase-encrypted `keys.json`
- **Package manager**: Bun (workspaces)

---

## Architecture Tiers

Packages live under `packages/*` and are arranged in tiers. **Imports flow downward only** — a higher tier may depend on a lower tier, never the reverse.

```
Binaries          server, cli
        ↑
Domain            mcp, ingest-core, ingest-github, ingest-custom,
                  metadata-optimizer, telemetry
        ↑
Strategy          queue, graph
        ↑
Cross-cutting     llm
        ↑
Infrastructure    config, logger, mongo, neo4j, redis
        ↑
Kernel            types
```

- `@bb/server` and `@bb/cli` are **the only deployables**. They never import each other — they communicate over HTTP only (enforced by an ESLint boundary rule).
- `@bb/cli` may import `@bb/types` and `@bb/config` (for shared shapes / paths) but must not pull in domain or strategy packages.
- A package may not import from a sibling at the same tier unless the dependency is explicitly modeled in `package.json`.

---

## Core Principles

### 1. Local-First, Single-Tenant

There is exactly one tenant: `orgId="local"`. A single shim in `@bb/mongo` injects this on every read/write; Neo4j queries always filter on it. Do not add per-tenant logic. Do not add auth middleware. Do not introduce user/org concepts.

### 2. One Package, One Responsibility

Each package owns exactly one concern. If a package needs a second name to describe what it does, split it.

### 3. Composition Roots Are Thin

`@bb/server` and `@bb/cli` wire packages together. They contain **no business logic**. All logic lives in domain or strategy packages.

### 4. Strict Separation of Layers

- **Routes** → HTTP shape only (parse + validate + delegate)
- **Controllers/Handlers** → Request orchestration
- **Services** → Business logic
- **Processors** → Phase pipeline execution
- **Workers** → Async job execution (in-process, BullMQ)
- **Adapters** (mongo / neo4j / redis / sqlite) → External system I/O

No layer skips another. The TUI is a special case: it is a thin HTTP client over the same routes; it does not reach into adapters.

### 5. Phase-Based Processing

All ingestion follows deterministic phases. Each phase:

- Has explicit inputs and outputs
- Persists progress before yielding
- Is independently retryable
- Verifies prior-phase state before running

Pipelines never assume the previous phase succeeded — they check.

### 6. Reliability Over Speed

- Every job is retryable
- Every state transition is persisted
- Dead-letter queues exist for every queue
- Long-running tasks checkpoint progress
- Partial failures are recoverable

### 7. Data Integrity

- Processing states are enums, never strings
- Inputs validated (Zod) before queue submission
- LLM outputs are untrusted until normalized
- Knowledge entities are immutable once `PROCESSED` — new versions, never mutations

### 8. Observability + Telemetry-by-Design

- Structured logging via `@bb/logger`
- Request and job IDs propagate across pipelines
- Health checks for every external system (Mongo / Neo4j / Redis probes)
- Every LLM call is recorded in the local cost ledger (`cost-ledger.sqlite`)
- Every HTTP + MCP event is buffered to ndjson and shipped by `@bb/telemetry` to ByteBell, tagged with `license_id`

Telemetry is **always-on by design** for v1 (this is a research data flow). License issuance is **independent** of telemetry — disabling telemetry does not bypass licensing.

### 9. Identifiers

- Public IDs are UUID v4
- MongoDB `_id` is internal only
- UUID fields are indexed and unique
- Job IDs are globally traceable
- `install_id` (UUID) is generated locally on first run; `license_id` comes from the issue endpoint

---

## Processing Status Lifecycle

```
CREATED → QUEUED → INGESTED → PROCESSING → PROCESSED
                                         ↘ FAILED
```

States are explicit, never inferred. Transitions are persisted before the next phase begins. Surfaced via `bytebell ls` and the dashboard's Repos pane.

---

## License + Local Config Layout

The `~/.bytebell/` directory is the **single source of truth** for runtime configuration. There is no `.env` file (see Rule of Env Vars).

```
~/.bytebell/
  config.json           server_port, mongo_uri, neo4j_uri/user/password,
                        redis_url, openrouter_model, concurrency.{pdf,website,github,bitbucket}
  keys.json             encrypted OpenRouter key (only when OS keychain is unavailable)
  license.json          signed JWT { license_id, install_id, issued_at, expires_at, tier }
  install_id            UUID generated on first run
  logs/
    server-YYYY-MM-DD.log
    cli-YYYY-MM-DD.log
    telemetry-buffer.ndjson
  pid                   running server PID
  cost-ledger.sqlite    one row per OpenRouter call (powers `bytebell cost`)
```

- `bytebell set <key> <value>` is the only sanctioned write path to `config.json`. Manual edits work but are not advertised.
- License has a 30-day TTL. CLI auto-refreshes within 7 days of expiry. Offline past expiry → server hard-fails until reachable.
- Public key for offline JWT signature verification is **embedded in source**; rotation is a release event.

---

# RULES (Hard Constraints)

These are enforced. Violations block PRs.

---

## Rule of Exploration

**Before touching code, read the context.**

Every contributor — human or AI agent — must, before making any change:

1. Read this `CLAUDE.md` end-to-end at least once per session.
2. Read [docs/arch.md](docs/arch.md) when working on architecture, ingestion flow, license, telemetry, or distribution.
3. Read the `context.md` of every package and folder you will modify, plus the `context.md` of every package you import from.
4. If a `context.md` is missing where one is required, stop and create it (or flag it) before making changes.
5. If the code contradicts `context.md`, treat `context.md` as authoritative for _intent_ — investigate the drift and update one or the other in the same PR. Never silently align one to the other.

Skipping exploration is the most common cause of tier violations, duplicated logic, and broken invariants.

---

## Rule of File Size

**No source file may exceed 300 lines.**

- Applies to all `*.ts` / `*.tsx` files in `packages/*`
- Tests, generated files, and JSON fixtures are exempt; documentation is held to the same limit
- When you need to add to a file already near the limit, split it first, then add

---

## Rule of Strict Types

TypeScript runs with every strict flag enabled (see [tsconfig.base.json](tsconfig.base.json)).

- Never use `any` — use `unknown` and narrow
- Never use `@ts-ignore`. `@ts-expect-error` is allowed only with a comment explaining the suppression and a tracking issue
- Never use the non-null assertion `!` to silence the compiler
- All public package exports must have explicit return types

---

## Rule of Package Manager

**Bun only.** No `npm` or `yarn` lockfiles in this repo. All scripts must be Bun-compatible. Add dependencies with `bun add`, never by hand-editing `package.json`. The runtime requires Bun on the user machine even when the CLI is installed via npm — `bytebell-server` uses `bun:sqlite`.

---

## Rule of Workspace Imports

Cross-package imports use the workspace name only.

- ✅ `import { X } from "@bb/types"`
- ❌ `import { X } from "../../types/src"`

Within a package, intra-package imports may use a path alias (e.g. `src/...`) but **never relative parent traversal**:

- ✅ `import { X } from "src/services/foo"`
- ❌ `import { X } from "../../services/foo"`

A package never reaches into another package's internals — only its public `index.ts` (or declared subpath exports).

---

## Rule of Dependency Direction

Imports follow tier order (see Architecture Tiers above). A package's `package.json` `dependencies` block is the source of truth — if you add an import, you must add the dependency. Cycles are forbidden.

**`@bb/cli` and `@bb/server` may not import each other.** They communicate over HTTP only. This is enforced by an ESLint boundary rule (see verification step 16 in [docs/arch.md](docs/arch.md)).

---

## Rule of Module Imports (ESM)

The codebase is pure ESM.

- Never use `require()` — it is not defined at runtime
- Never use dynamic `import()` — all imports are static and top-level
- Conditional features gate **usage**, not the import

---

## Rule of Env Vars

**No `.env` file. Anywhere. Ever.**

- Every setting lives in `~/.bytebell/config.json` and is written exclusively by `bytebell set …` (or the first-run setup form)
- The server reads `config.json` directly via `@bb/config` and **must refuse to read `process.env.MONGODB_URI`** or any equivalent
- No `.env.example`, no `dotenv` package as a dependency, no `-env-file` flag

```ts
import { getConfigValue, Config } from "@bb/config";
const url = getConfigValue(Config.MongoUri);
```

If a piece of infra is missing from `config.json`, the server prints the exact `bytebell set …` command and refuses to boot.

---

## Rule of LLM Provider

**OpenRouter only.** No direct Anthropic / OpenAI / Gemini / Bedrock keys. All LLM calls flow through `@bb/llm`, which:

- Wraps every OpenRouter call
- Records cost via `calculateCostFromModelTokens()` into `~/.bytebell/cost-ledger.sqlite`
- Surfaces token totals to telemetry

LLM outputs are probabilistic. They must be:

- Validated against a schema before use
- Normalized before persistence
- Never written directly to a domain store

The user-facing model list is curated (5–10 top models). `bytebell models set` validates against OpenRouter on the fly.

---

## Rule of License Verification

The server is license-gated. The license check is independent of telemetry.

- `bytebell-server` verifies `~/.bytebell/license.json` on boot **and on every MCP request**, using the embedded public key
- Missing / invalid signature / expired → refuse to boot or refuse to handle the request, with the message `bytebell license refresh`
- A future telemetry-disable flag does **not** disable license issuance or verification
- Anyone forking the source can remove the check — that is acceptable. The gate is a soft contract for installs of the official build

Do not add fallback paths that skip verification "for development." Use a real, valid license issued from staging.

---

## Rule of Telemetry

Telemetry is always-on in v1.

- All HTTP + MCP request/response bodies (with `keys.json` values redacted) are written to `~/.bytebell/logs/telemetry-buffer.ndjson`
- The buffer is flushed every 60 s (or on `SIGTERM`) to the ByteBell ingest endpoint
- Each event is tagged with `license_id`
- Buffer caps at 100 MB with exponential-backoff retries
- The OSS README must clearly disclose this data flow

A `bytebell telemetry disable` flag is **out of scope for v1** and must not be added without explicit product sign-off.

---

## Rule of API Logging & Documentation

Every HTTP route declares:

- OpenAPI / Swagger schema (request, response, errors)
- Status descriptions
- Auth requirements (always "none — single-tenant, orgId=local")

Undocumented endpoints are not allowed.

---

## Rule of Queue Safety

- Jobs are idempotent
- Workers tolerate restarts mid-job
- Payloads are versioned
- Retries do not duplicate side effects (use job-level dedupe keys)
- Workers run **in-process** — they share the server's lifecycle and config

---

## Rule of Memory Safety

Workers run against very large repositories on bounded local hardware.

- Stream from disk; do not buffer whole files
- Batch writes to graph and storage
- Adaptive memory monitoring is required for long-running phases

---

## Rule of Feature Flags

Major subsystems are toggleable via `@bb/config`. Disabled features degrade gracefully — they do not throw at import time. Conditional features gate **usage**, not the import (see Rule of Module Imports).

---

## Rule of Variable Scope in Branching Pipelines

When a variable is produced in one branch of an `if/else` and consumed after both branches, declare it in the outer scope with a safe default. Guard any usage that is meaningful only in one branch.

---

## Rule of Plans

Plans (under `docs/`) are prose architecture documents. They describe **what and why**, never **how in code**.

- No implementation snippets
- No pseudo-code
- Human-readable, expressive, structural

---

## Rule of New Packages

To add a package:

1. Create `packages/<name>/` with `package.json` (`@bb/<name>`)
2. Add `tsconfig.json` extending `../../tsconfig.base.json`
3. Add it to the root `tsconfig.json` `references` array
4. Declare workspace deps explicitly in `package.json`
5. Create `context.md` describing the package's contract (see below)

A package without `context.md` is not allowed.

---

# Folder Context Rules (`context.md`)

Every package and every major subfolder MUST contain a `context.md`.

`context.md` defines the operational contract:

- Responsibilities
- Public interfaces (exports)
- Data ownership
- Invariants
- External dependencies
- Tier (kernel / infra / strategy / domain / binary)

**Before modifying a folder**, read its `context.md`. **When code changes**, update `context.md` in the same PR. PRs are rejected if `context.md` is missing, stale, or contradicts the code.

---

## Naming Conventions

- Processors: `GithubProcessor.ts`
- Phases: `ClonePhase.ts`, `ParsePhase.ts`
- Strategies: `FlatFolderStrategy.ts`
- Enums: `*.enum.ts`
- Ink components (panes, forms): `DashboardPane.tsx`, `SetupForm.tsx` — `.tsx` because Ink renders JSX to the terminal
- Commander subcommand entry points: `IndexCommand.ts`, `CleanCommand.ts` — plain `.ts`, no JSX
- Services: single-responsibility, named for what they do
- Types: live in the package's `types/` or root `index.ts`
- Avoid ambiguous names (`Manager`, `Helper`, `Util`)

---

## Architecture Philosophy

Bytebell-public is **a local research instrument**, not a hosted service.

It exists so a single developer, an OSS community, or a research team can run a durable knowledge engine on their own infrastructure — turning raw repos, PDFs, and websites into a queryable graph and exposing them through MCP. The license + telemetry pipeline closes the loop back to ByteBell so that real-world usage informs the engine's evolution.

Design for:

- **Clarity over cleverness**
- **Explicit ownership** — every behavior has exactly one home package
- **Local-first** — no hidden cloud dependencies beyond license + telemetry
- **Deterministic pipelines** over heuristics
- **Recoverability** over performance shortcuts
- **Auditability** — every LLM-derived fact is traceable to its source via the cost ledger and telemetry buffer
- **Long-term maintainability** over rapid hacks

Prefer:

- Explicit systems over implicit magic
- Composition over inheritance
- Provider-agnostic, storage-agnostic, network-agnostic abstractions
- Small files, narrow packages, deep tier discipline
- HTTP boundaries between deployables, never shared in-process state
