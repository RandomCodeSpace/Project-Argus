package telemetry

import (
	"encoding/json"
	"net/http"
	"sync/atomic"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics holds all internal Prometheus metrics for Argus self-monitoring.
type Metrics struct {
	IngestionRate     prometheus.Counter
	ActiveConnections prometheus.Gauge
	DBLatency         prometheus.Histogram
	DLQSize           prometheus.Gauge

	// Atomic counters for JSON health endpoint (avoids scraping Prometheus)
	totalIngested  atomic.Int64
	activeConns    atomic.Int64
	dlqFileCount   atomic.Int64
	dbLatencyP99Ms atomic.Int64
}

// New creates and registers all Argus internal metrics.
func New() *Metrics {
	m := &Metrics{
		IngestionRate: promauto.NewCounter(prometheus.CounterOpts{
			Name: "argus_ingestion_rate",
			Help: "Total number of spans and logs ingested.",
		}),
		ActiveConnections: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "argus_active_connections",
			Help: "Number of active WebSocket client connections.",
		}),
		DBLatency: promauto.NewHistogram(prometheus.HistogramOpts{
			Name:    "argus_db_latency",
			Help:    "Database operation latency in seconds.",
			Buckets: prometheus.DefBuckets,
		}),
		DLQSize: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "argus_dlq_size",
			Help: "Number of files currently in the Dead Letter Queue.",
		}),
	}
	return m
}

// RecordIngestion increments the ingestion counter by the given batch size.
func (m *Metrics) RecordIngestion(count int) {
	m.IngestionRate.Add(float64(count))
	m.totalIngested.Add(int64(count))
}

// SetActiveConnections updates the active WebSocket connection gauge.
func (m *Metrics) SetActiveConnections(n int) {
	m.ActiveConnections.Set(float64(n))
	m.activeConns.Store(int64(n))
}

// IncrementActiveConns atomically adds 1 to the active connection count.
func (m *Metrics) IncrementActiveConns() {
	n := m.activeConns.Add(1)
	m.ActiveConnections.Set(float64(n))
}

// DecrementActiveConns atomically subtracts 1 from the active connection count.
func (m *Metrics) DecrementActiveConns() {
	n := m.activeConns.Add(-1)
	if n < 0 {
		n = 0
		m.activeConns.Store(0)
	}
	m.ActiveConnections.Set(float64(n))
}

// SetDLQSize updates the DLQ size gauge.
func (m *Metrics) SetDLQSize(n int) {
	m.DLQSize.Set(float64(n))
	m.dlqFileCount.Store(int64(n))
}

// ObserveDBLatency records a database operation latency in seconds.
func (m *Metrics) ObserveDBLatency(seconds float64) {
	m.DBLatency.Observe(seconds)
	m.dbLatencyP99Ms.Store(int64(seconds * 1000))
}

// HealthStats is the JSON response for GET /api/health.
type HealthStats struct {
	IngestionRate  int64   `json:"ingestion_rate"`
	DLQSize        int64   `json:"dlq_size"`
	ActiveConns    int64   `json:"active_connections"`
	DBLatencyP99Ms float64 `json:"db_latency_p99_ms"`
}

// GetHealthStats returns a snapshot of current telemetry values.
func (m *Metrics) GetHealthStats() HealthStats {
	return HealthStats{
		IngestionRate:  m.totalIngested.Load(),
		DLQSize:        m.dlqFileCount.Load(),
		ActiveConns:    m.activeConns.Load(),
		DBLatencyP99Ms: float64(m.dbLatencyP99Ms.Load()),
	}
}

// HealthHandler returns an http.HandlerFunc for GET /api/health.
func (m *Metrics) HealthHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(m.GetHealthStats())
	}
}

// PrometheusHandler returns the standard Prometheus metrics handler for GET /metrics.
func PrometheusHandler() http.Handler {
	return promhttp.Handler()
}
