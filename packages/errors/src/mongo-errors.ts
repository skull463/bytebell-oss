export class MongoConfigError extends Error {
  override readonly name = "MongoConfigError";
  readonly hint: string;

  constructor(hint: string) {
    super(`Mongo URI is not configured. Run:\n  ${hint}`);
    this.hint = hint;
  }
}

export class MongoConnectError extends Error {
  override readonly name = "MongoConnectError";

  constructor(uri: string, cause: unknown) {
    super(`Failed to connect to MongoDB at ${redactUri(uri)}: ${describe(cause)}`);
    this.cause = cause;
  }
}

export class MongoNotConnectedError extends Error {
  override readonly name = "MongoNotConnectedError";

  constructor() {
    super("MongoDB client is not connected. Call connectMongo() first.");
  }
}

export class KnowledgeNotFoundError extends Error {
  override readonly name = "KnowledgeNotFoundError";
  readonly knowledgeId: string;

  constructor(knowledgeId: string) {
    super(`No knowledge document found with knowledgeId="${knowledgeId}".`);
    this.knowledgeId = knowledgeId;
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function redactUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/u, "//$1:***@");
}
