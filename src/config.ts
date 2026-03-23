/**
 * Configuration loaded from environment variables with sensible defaults.
 * Matches the Go version's 40+ env vars.
 */
export interface Config {
  env: string;
  devMode: boolean;
  logLevel: string;
  httpPort: string;
  grpcPort: string;
  dbDriver: string;
  dbDSN: string;
  dlqPath: string;
  dlqReplayInterval: string;

  // Ingestion Filtering
  ingestMinSeverity: string;
  ingestAllowedServices: string;
  ingestExcludedServices: string;

  // DB Connection Pool
  dbMaxOpenConns: number;
  dbMaxIdleConns: number;
  dbConnMaxLifetime: string;

  // Hot/Cold Storage
  hotRetentionDays: number;
  coldStoragePath: string;
  coldStorageMaxGB: number;
  archiveScheduleHour: number;
  archiveBatchSize: number;

  // TSDB
  tsdbRingBufferDuration: string;

  // Adaptive Sampling
  samplingRate: number;
  samplingAlwaysOnErrors: boolean;
  samplingLatencyThresholdMs: number;

  // Metric Cardinality
  metricAttributeKeys: string;
  metricMaxCardinality: number;

  // DLQ Safety
  dlqMaxFiles: number;
  dlqMaxDiskMB: number;
  dlqMaxRetries: number;

  // API Protection
  apiRateLimitRPS: number;

  // MCP Server
  mcpEnabled: boolean;
  mcpPath: string;

  // Compression
  compressionLevel: string;

  // Vector Index
  vectorIndexMaxEntries: number;
}

function getEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function getEnvInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v !== undefined) {
    const n = parseInt(v, 10);
    if (!isNaN(n)) return n;
  }
  return fallback;
}

function getEnvFloat(key: string, fallback: number): number {
  const v = process.env[key];
  if (v !== undefined) {
    const n = parseFloat(v);
    if (!isNaN(n)) return n;
  }
  return fallback;
}

function getEnvBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v !== undefined) {
    return v === "true" || v === "1" || v === "yes";
  }
  return fallback;
}

export function loadConfig(): Config {
  const env = getEnv("APP_ENV", "development");
  return {
    env,
    devMode: env === "development",
    logLevel: getEnv("LOG_LEVEL", "INFO"),
    httpPort: getEnv("HTTP_PORT", "8080"),
    grpcPort: getEnv("GRPC_PORT", "4317"),
    dbDriver: getEnv("DB_DRIVER", "sqlite"),
    dbDSN: getEnv("DB_DSN", ""),
    dlqPath: getEnv("DLQ_PATH", "./data/dlq"),
    dlqReplayInterval: getEnv("DLQ_REPLAY_INTERVAL", "5m"),

    ingestMinSeverity: getEnv("INGEST_MIN_SEVERITY", "INFO"),
    ingestAllowedServices: getEnv("INGEST_ALLOWED_SERVICES", ""),
    ingestExcludedServices: getEnv("INGEST_EXCLUDED_SERVICES", ""),

    dbMaxOpenConns: getEnvInt("DB_MAX_OPEN_CONNS", 50),
    dbMaxIdleConns: getEnvInt("DB_MAX_IDLE_CONNS", 10),
    dbConnMaxLifetime: getEnv("DB_CONN_MAX_LIFETIME", "1h"),

    hotRetentionDays: getEnvInt("HOT_RETENTION_DAYS", 7),
    coldStoragePath: getEnv("COLD_STORAGE_PATH", "./data/cold"),
    coldStorageMaxGB: getEnvInt("COLD_STORAGE_MAX_GB", 50),
    archiveScheduleHour: getEnvInt("ARCHIVE_SCHEDULE_HOUR", 2),
    archiveBatchSize: getEnvInt("ARCHIVE_BATCH_SIZE", 10000),

    tsdbRingBufferDuration: getEnv("TSDB_RING_BUFFER_DURATION", "1h"),

    samplingRate: getEnvFloat("SAMPLING_RATE", 1.0),
    samplingAlwaysOnErrors: getEnvBool("SAMPLING_ALWAYS_ON_ERRORS", true),
    samplingLatencyThresholdMs: getEnvInt("SAMPLING_LATENCY_THRESHOLD_MS", 500),

    metricAttributeKeys: getEnv("METRIC_ATTRIBUTE_KEYS", ""),
    metricMaxCardinality: getEnvInt("METRIC_MAX_CARDINALITY", 10000),

    dlqMaxFiles: getEnvInt("DLQ_MAX_FILES", 1000),
    dlqMaxDiskMB: getEnvInt("DLQ_MAX_DISK_MB", 500),
    dlqMaxRetries: getEnvInt("DLQ_MAX_RETRIES", 10),

    apiRateLimitRPS: getEnvInt("API_RATE_LIMIT_RPS", 100),

    mcpEnabled: getEnvBool("MCP_ENABLED", true),
    mcpPath: getEnv("MCP_PATH", "/mcp"),

    compressionLevel: getEnv("COMPRESSION_LEVEL", "default"),

    vectorIndexMaxEntries: getEnvInt("VECTOR_INDEX_MAX_ENTRIES", 100000),
  };
}

export function validateConfig(cfg: Config): void {
  const httpPort = parseInt(cfg.httpPort, 10);
  if (isNaN(httpPort) || httpPort < 1 || httpPort > 65535) {
    throw new Error(`Invalid HTTP_PORT "${cfg.httpPort}": must be 1-65535`);
  }
  const grpcPort = parseInt(cfg.grpcPort, 10);
  if (isNaN(grpcPort) || grpcPort < 1 || grpcPort > 65535) {
    throw new Error(`Invalid GRPC_PORT "${cfg.grpcPort}": must be 1-65535`);
  }
  if (!["sqlite"].includes(cfg.dbDriver.toLowerCase())) {
    throw new Error(`Invalid DB_DRIVER "${cfg.dbDriver}": only sqlite is supported in TS rewrite`);
  }
  if (cfg.hotRetentionDays < 1) {
    throw new Error(`HOT_RETENTION_DAYS must be >= 1, got ${cfg.hotRetentionDays}`);
  }
  if (cfg.archiveScheduleHour < 0 || cfg.archiveScheduleHour > 23) {
    throw new Error(`ARCHIVE_SCHEDULE_HOUR must be 0-23, got ${cfg.archiveScheduleHour}`);
  }
  if (cfg.samplingRate < 0 || cfg.samplingRate > 1.0) {
    throw new Error(`SAMPLING_RATE must be between 0 and 1, got ${cfg.samplingRate}`);
  }
  if (!["default", "fast", "best"].includes(cfg.compressionLevel.toLowerCase())) {
    throw new Error(`Invalid COMPRESSION_LEVEL "${cfg.compressionLevel}"`);
  }
}
