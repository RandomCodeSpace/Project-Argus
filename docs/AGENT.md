# Argus V2: Project Master Plan & Agent Guide

## 🚀 Project Overview
**Project Argus V2 Enterprise Edition** is a high-performance observability platform designed to ingest, store, and visualize OpenTelemetry (OTLP) Traces and Logs. It features a modern React frontend and a robust Go backend.

## 🛠️ Technology Stack
- **Frontend**: React, TypeScript, Ant Design, TanStack Table, Highcharts, Vite.
- **Backend**: Go (Golang) 1.25+, GORM (ORM), OpenTelemetry (OTLP Receiver).
- **Database**: 
  - **Dev**: MySQL (Default, containerized or local).
  - **Supported**: SQLite, SQL Server.
- **Communication**: gRPC (Ingestion), HTTP/REST (Querying).

## 🏗️ Architecture
1.  **Ingestion Layer (`internal/ingest`)**:
    -   gRPC Server listening on `:4317`.
    -   Handles `OTLP/gRPC` traces and logs.
    -   Batches data for efficient storage.
2.  **Storage Layer (`internal/storage`)**:
    -   Uses GORM for database abstraction.
    -   Stores `Traces`, `Spans`, and `Logs` in relational tables.
    -   Optimized for time-series querying (`timestamp` indexing).
3.  **API Layer (`internal/api`)**:
    -   REST API listening on `:8080`.
    -   Provides endpoints for Dashboard statistics, Log querying, and Trace waterfall data.
    -   Supports Server-Sent Events (SSE) for live log streaming.
4.  **AI Layer (`internal/ai`)**:
    -   Background worker for log analysis (Simulated).
    -   Updates logs with "AI Insights" asynchronously.
5.  **Frontend (`web/`)**:
    -   Single Page Application (SPA).
    -   **Dashboard**: Real-time metrics (Traffic, Latency, Errors).
    -   **Log Explorer**: Advanced log search with context interaction.
    -   **Traces**: Distributed tracing visualization (Waterfall).
    -   **Settings**: Configuration and system health.

## ✅ Implementation Status
### Core Features
- [x] **OTLP Ingestion**: Fully functional gRPC receiver for Traces and Logs.
- [x] **Storage**: MySQL persistence with GORM.
- [x] **Live Streaming**: SSE implementation for real-time logs.
- [x] **Global Time Filter**: Date/Time picker in Header controlling all views.
- [x] **Dashboard**: Highcharts visualization of traffic, latency, and service health.
- [x] **Log Explorer**: TanStack Table implementation with JSON expansion.
- [x] **Traces**: TanStack Table with manual pagination and expansion.
- [x] **Configuration**: `.env` support for production readiness.
- [x] **Settings Page**: System status, configuration display, data management controls.

### Recent Improvements
- Moved from Ant Design `Table` to `TanStack Table` for performance and flexibility.
- Implemented `godotenv` for standard configuration management.
- Standardized Date Formats (`HH:mm DD-MMM`).
- Added Skeleton loaders and Empty states for improved UX.
- Implemented "Top Failing Services" chart for service health monitoring.

## 🗺️ Roadmap & Future Tasks
### 1. Refinement & Polish
- [ ] **Timezone Sync**: Fix UTC vs Local Time discrepancy in charts.
- [ ] **Mobile Responsiveness**: Improve layout on smaller screens.
- [ ] **Alerting**: Basic threshold-based alerting structure.

### 2. Scalability
- [ ] **ClickHouse Support**: Migrate storage backend for high-volume telemetry.
- [ ] **Identify & Access Management (IAM)**: Add authentication (JWT) for the frontend.
- [ ] **Distributed Tracing Enhancements**: Trace graph visualization.

### 3. Reliability (Chaos Engineering)
- [ ] **Chaos Testing**: Expand `load_test.ps1` to simulate network partitions and DB failures.
- [ ] **Resiliency**: Implement circuit breakers in the backend.
- [ ] **Health Checks**: Proper endpoint for k8s/docker healthchecks.

## 👨‍💻 Developer Guide
### Running Locally
1.  **Setup Configuration**:
    ```bash
    cp .env.example .env
    ```
2.  **Start Server**:
    ```bash
    go run cmd/server/main.go
    ```
    *Server runs on localhost:8080 (HTTP) and localhost:4317 (gRPC)*

### Frontend Development
1.  Navigate to `web/`:
    ```bash
    cd web
    npm install
    npm run dev
    ```
2.  Build for Production (embeds into Go binary):
    ```bash
    npm run build
    ```

### Load Testing
```powershell
.\test\load_test.ps1 -concurrent 5 -iterations 20
```

## 🤖 Agent Context
- **Code Style**: Go (Standard formatting), React (Functional components, Hooks).
- **State Management**: React Query (Server state), Context API (Global UI state like TimeRange).
- **Naming Conventions**: `CamelCase` for JS, `snake_case` for DB columns, `Go` standard naming.
- **Key Files**:
    -   `cmd/server/main.go`: Entry point.
    -   `internal/storage/repository_v2.go`: Complex queries (Charts, Stats).
    -   `web/src/layouts/AppLayout.tsx`: Main layout and router.
    -   `web/src/features/logs/LogExplorer.tsx`: Main logs view.
    -   `web/src/features/dashboard/Dashboard.tsx`: Dashboard with Highcharts.

## 📝 Important Notes
- All timestamps in database use UTC.
- Frontend time picker displays local time.
- Highcharts should be configured with `useUTC: false` (or `timezoneOffset`) for proper display.
- Database connection fallback: MySQL on `10.0.0.2:3306/argus`.
