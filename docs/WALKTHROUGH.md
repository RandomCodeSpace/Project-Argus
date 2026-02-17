# Argus V2 Enterprise - Walkthrough

## 1. Run the V2 Server
Start the ARGUS V2 Enterprise server. It will serve the new React frontend and the API.
```powershell
go run ./cmd/server
```
*Verify: You should see the "Project ARGUS V2: Enterprise Edition" banner.*

## 2. Generate Enterprise Load
Run the updated load test script to simulate concurrent traffic and chaos scenarios.
```powershell
.\test\load_test.ps1 -concurrent 5 -iterations 20
```
*Verify: You should see orders being placed, creating Traces and Logs. You might see 500 errors (Chaos).*

## 3. Verify Enterprise Features
Open [http://localhost:8080](http://localhost:8080) in your browser.

### Dashboard
- **Global Time Filter**: Use the header date picker to select time range (default: last 5 minutes).
- **Service Filter**: Select specific services (order-service, payment-service) to filter data.
- **Metrics Cards**: View Total Traces, Error Rate, P99 Latency, and Active Services with skeleton loading states.
- **Traffic Volume**: Check the AreaSpline chart for traffic spikes (with visible markers).
- **Top Failing Services**: Bar chart showing services with most errors.
- **Latency Heatmap**: Scatter plot showing trace latency distribution.

### Log Explorer
- Navigate to **Logs** in the sidebar.
- **Volume Chart**: Check the bar chart at the top showing recent log volume.
- **TanStack Table**: Browse logs with server-side pagination.
- **Expandable Rows**: Click arrow to expand and view full log details with JSON formatting.
- **Context**: Click "Context" button on any log to see surrounding logs (+/- 1 min).
- **AI Insight**: Look for the Brain icon and expand the row to see simulated AI analysis.
- **TraceID Links**: Click TraceID to navigate to Traces page.

### Traces
- Navigate to **Traces** in the sidebar.
- **TanStack Table**: Browse traces with server-side pagination and sorting.
- **Expandable Rows**: Click arrow to view span waterfall/details.
- **Link to Logs**: Click "View Logs" to see all logs for that trace.

### Settings
- Navigate to **Settings** in the sidebar.
- **System Status**: View version, environment, database type, and uptime.
- **Configuration**: Review active HTTP/gRPC ports and retention policies.
- **Data Management**: UI for purge and reset operations (not yet functional).

## 4. Environment Configuration (Production Ready)
We have introduced a production-ready configuration system using `.env` files.

### Key Changes
- **Dependency**: Added `github.com/joho/godotenv`.
- **Config Package**: New `internal/config` package to load environment variables.
- **Entry Point**: Updated `cmd/server/main.go` to load config at startup.

### How to Use
1.  Copy `.env.example` to `.env`.
2.  Update values in `.env` (e.g., `DB_DSN`, `HTTP_PORT`, `GRPC_PORT`).
3.  Run the server: `go run cmd/server/main.go`.

> [!NOTE]
> The application will fallback to default values (localhost, mysql) if `.env` is missing, ensuring dev experience remains smooth.

## 5. Recent Improvements

### Dashboard Polish
- **Skeleton Loaders**: Replaced spinners with smooth skeleton animations for metrics and charts.
- **Empty States**: Charts now display "No Data" states instead of empty space.
- **Metric Cards**: Refactored into reusable component with individual loading states.
- **Service Health**: Added "Top Failing Services" bar chart to visualize error hotspots.
- **Chart Performance**: Memoized Highcharts options for better re-rendering performance.

### TanStack Table Migration
- Migrated both Log Explorer and Traces to TanStack Table for consistency.
- Improved pagination, sorting, and expansion performance.
- Removed dependency on Ant Design Table for these components.

### Global Time Filter
- Centralized time range picker in header.
- Format: `HH:mm DD-MMM` (e.g., "22:37 17-Feb").
- Affects Dashboard, Logs, and Traces simultaneously.
- Presets: Last 5m, 15m, 30m, 1h, 6h, 24h.
- Maximum range: 7 days.

## 6. Known Issues & Troubleshooting

### Timezone Discrepancy
- **Symptom**: Chart X-axis shows different time than filter displayed time.
- **Cause**: Backend stores timestamps in UTC, Highcharts may display in UTC by default.
- **Fix**: Set `Highcharts.setOptions({ global: { useUTC: false } })` (or use `timezoneOffset`).

### Load Test Errors
- **500/502 Errors**: Expected due to chaos engineering (intentional failures).
- **Error Rate**: Should be ~20-30% when both services are running with chaos enabled.

### Build Warnings
- **Bundle Size**: Frontend bundle is >500KB after minification.
- **Recommendation**: Implement code splitting for Highcharts and other large dependencies.
