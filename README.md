# Project Argus

[![Latest Release](https://img.shields.io/github/v/release/RandomCodeSpace/Project-Argus)](https://github.com/RandomCodeSpace/Project-Argus/releases)
[![Security Audit](https://github.com/RandomCodeSpace/Project-Argus/actions/workflows/audit.yml/badge.svg)](https://github.com/RandomCodeSpace/Project-Argus/actions)
![Go Version](https://img.shields.io/github/go-mod/go-version/RandomCodeSpace/Project-Argus)
![React](https://img.shields.io/badge/frontend-React%20v18-61dafb?logo=react)

Project Argus is an integrated observability and AI analysis platform.

## Getting Started

### Installation
```bash
go install github.com/RandomCodeSpace/Project-Argus/cmd/argus@latest
```

### Running
Simply run the binary:
```bash
argus
```
By default, Argus will use an embedded SQLite database (`argus.db`) in the current directory. No configuration is required.

### Configuration (Optional)
You can configure the database using environment variables or a `.env` file:

- **MySQL**:
  ```bash
  DB_DRIVER=mysql
  DB_DSN=root:password@tcp(localhost:3306)/argus?charset=utf8mb4&parseTime=True&loc=Local
  ```
- **SQLite** (Default):
  ```bash
  DB_DRIVER=sqlite
  DB_DSN=argus.db
  ```

## Features
- **Traces**: OTLP Trace ingestion and visualization.
- **Logs**: Structured logging with AI-powered insights.
- **Dashboard**: Real-time metrics and traffic analysis.

## OTLP Integration
Argus acts as an OTLP Receiver (gRPC) on port `4317` by default.

### As an OTel Collector Target
You can configure any OpenTelemetry Collector to export data to Argus.

```yaml
exporters:
  otlp/argus:
    endpoint: "localhost:4317"
    tls:
      insecure: true

service:
  pipelines:
    traces:
      exporters: [otlp/argus]
    logs:
      exporters: [otlp/argus]
```
See `docs/otel-collector-example.yaml` for a full configuration example.
