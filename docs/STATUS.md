# Argus V2: Enterprise Edition - Project Status

## 🟢 Phase 1: Go Backend Core
- [x] **GORM Models (V2)**
    - [x] Update `Trace`, `Span`, `Log` structs matching V2 spec.
    - [x] Add Indexes: `ServiceName`, `TraceID`, `Timestamp`, `Severity`.
- [x] **API Layer (New)**
    - [x] `GET /api/metrics/traffic` (Traffic Chart)
    - [x] `GET /api/metrics/latency_heatmap` (Heatmap)
    - [x] `GET /api/logs` (Filtering & Search)
    - [x] `GET /api/logs/context` (Surrounding logs)
    - [x] `GET /api/metrics/dashboard` (Dashboard Stats + Top Failing Services)
- [x] **Server Core**
    - [x] Update Banner to "Argus V2".
    - [x] Ensure `web/dist` allows SPA catch-all.
    - [x] Default DB to MySQL and disable auto-drop [repository.go]
    - [x] Optimize OTLP ingestion further [otlp.go]
    - [x] Final UI/UX polish for Dashboard
    - [ ] Sync Timezone (UI vs Charts) - **IN PROGRESS**
- [x] Implement .env configuration (Production Ready)
- [x] Implement Settings Tab
- [x] Create agent.md (Master Implementation Plan)
- [x] Implement Traces Page [Traces.tsx] (Migrated to TanStack Table)

## 🟠 Phase 2: Chaos Test Services
- [x] **Order Service (9001)**
    - [x] Call Payment Service.
    - [x] Chaos: 30% 500ms latency, 10% "Inventory Critical Error".
- [x] **Payment Service (9002)**
    - [x] Chaos: 20% HTTP 500 "Gateway Timeout".
- [x] **Load Generator**
    - [x] Ensure `load_test.ps1` hits Order Service concurrently.

## 🔵 Phase 3: React Frontend (Enterprise UI)
- [x] **Theme & Layout**
    - [x] Revert "Cyber" theme to "Clean Enterprise" (AntD Default).
    - [x] Sidebar: Dashboard, Logs, Traces, Settings.
- [x] **Dashboard**
    - [x] Filters: Time Range, Service Name (Refetch on change).
    - [x] Metrics: Traces/Sec, Error Rate, Active Services, P99 Latency.
    - [x] Charts (Highcharts):
        - [x] Traffic Volume (AreaSpline).
        - [x] Top Failing Services (Bar Chart).
        - [x] Latency Heatmap (Scatter).
    - [x] Skeleton Loaders & Empty States
- [x] **Log Explorer**
    - [x] Log Volume Chart.
    - [x] Filter Toolbar (Service, Severity, Search).
    - [x] Log Table (Timestamp, Severity, Service, Body).
    - [x] Log Details (Expandable Row, JSON Pretty Print, AI Insight).
    - [x] Context Button (Fetch +/- 1 min logs).
    - [x] Refactor to TanStack Table (Match Traces.tsx)
- [x] **Traces Page**
    - [x] TanStack Table with manual pagination
    - [x] Expandable rows with span waterfall
    - [x] Link to Logs via TraceID

## 🟣 Verification
- [x] Full System Integration Test
- [x] Verify Traces Page with TanStack Table (Filtering, Pagination, Expansion)
- [x] Link Trace ID to Logs (Traces -> Log Explorer)
- [x] Time Range Controls (Presets, Default 5m, Max 7d)
- [x] Load Testing with `load_test.ps1`

## 🔴 Known Issues
- [ ] Timezone discrepancy between UI filter and chart display (Backend stores UTC, Frontend displays Local)
- [ ] Highcharts `useUTC` configuration needs verification
- [ ] Minor: Large bundle size warning (1.5MB+ after gzip)

## 📋 Next Priorities
1. **Fix Timezone Issue** - Ensure charts display in user's local timezone
2. **Performance Optimization** - Code splitting for frontend bundle
3. **Authentication** - Add basic JWT auth
4. **Alerting System** - Threshold-based alerts for error rate/latency
