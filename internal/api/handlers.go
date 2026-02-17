package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/RandomCodeSpace/Project-Argus/internal/storage"
)

type Server struct {
	repo         *storage.Repository
	logClients   map[chan storage.Log]bool
	logClientsMu sync.Mutex
}

func NewServer(repo *storage.Repository) *Server {
	return &Server{
		repo:       repo,
		logClients: make(map[chan storage.Log]bool),
	}
}

// RegisterRoutes registers API endpoints on the provided mux.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/stats", s.handleGetStats)
	mux.HandleFunc("GET /api/traces", s.handleGetTraces)
	mux.HandleFunc("GET /api/metrics/traffic", s.handleGetTrafficMetrics)
	mux.HandleFunc("GET /api/metrics/latency_heatmap", s.handleGetLatencyHeatmap)
	mux.HandleFunc("GET /api/metrics/dashboard", s.handleGetDashboardStats)
	mux.HandleFunc("GET /api/logs", s.handleGetLogsV2) // Replaces old simple handleGetLogs
	mux.HandleFunc("GET /api/logs/stream", s.handleStreamLogs)
	mux.HandleFunc("GET /api/logs/context", s.handleGetLogContext)
	mux.HandleFunc("GET /api/logs/{id}/insight", s.handleGetLogInsight)
}

// BroadcastLog sends a new log entry to all connected SSE clients.
// This should be called by the ingestion layer or a background worker.
func (s *Server) BroadcastLog(l storage.Log) {
	s.logClientsMu.Lock()
	defer s.logClientsMu.Unlock()

	for ch := range s.logClients {
		select {
		case ch <- l:
		default:
			// If client is slow, drop the message or close connection?
			// For now, drop to avoid blocking.
		}
	}
}

// parseTimeRange parses start and end times from request query parameters
func parseTimeRange(r *http.Request) (time.Time, time.Time, error) {
	var start, end time.Time

	if startStr := r.URL.Query().Get("start"); startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			start = t
		}
	}
	if endStr := r.URL.Query().Get("end"); endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			end = t
		}
	}

	return start, end, nil
}

func (s *Server) handleGetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.repo.GetStats()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (s *Server) handleGetTraces(w http.ResponseWriter, r *http.Request) {
	// Parse pagination
	limit := 20
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil {
			offset = v
		}
	}

	// Parse time range
	start, end, err := parseTimeRange(r)
	if err != nil {
		http.Error(w, fmt.Sprintf("Invalid time range: %v", err), http.StatusBadRequest)
		return
	}

	// Parse service names
	serviceNames := r.URL.Query()["service_name"]

	// Parse status filter
	status := r.URL.Query().Get("status")

	// Parse search (trace ID)
	// Parse search (trace ID)
	search := r.URL.Query().Get("search")

	// Parse sorting
	sortBy := r.URL.Query().Get("sort_by")
	orderBy := r.URL.Query().Get("order_by")

	// Fetch filtered traces
	response, err := s.repo.GetTracesFiltered(start, end, serviceNames, status, search, limit, offset, sortBy, orderBy)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Server) handleStreamLogs(w http.ResponseWriter, r *http.Request) {
	// Set headers for SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Create a channel for this client
	clientChan := make(chan storage.Log, 10)

	// Register client
	s.logClientsMu.Lock()
	s.logClients[clientChan] = true
	s.logClientsMu.Unlock()

	// Ensure cleanup on disconnect
	defer func() {
		s.logClientsMu.Lock()
		delete(s.logClients, clientChan)
		close(clientChan)
		s.logClientsMu.Unlock()
	}()

	// Send a keep-alive ticker
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": keep-alive\n\n")
			flusher.Flush()
		case logEntry := <-clientChan:
			// Format as SSE event
			data, err := json.Marshal(logEntry)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func (s *Server) handleGetLogInsight(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	if idStr == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	l, err := s.repo.GetLog(uint(id))
	if err != nil {
		http.Error(w, "log not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"insight": l.AIInsight})
}
