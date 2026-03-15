package ui

import (
	"embed"
	"html/template"
	"net/http"
	"strings"

	"github.com/RandomCodeSpace/argus/internal/graph"
	"github.com/RandomCodeSpace/argus/internal/storage"
	"github.com/RandomCodeSpace/argus/internal/telemetry"
	"github.com/RandomCodeSpace/argus/internal/vectordb"
)

//go:embed templates/*.html static/*
var content embed.FS

type Server struct {
	repo    *storage.Repository
	metrics *telemetry.Metrics
	topo    *graph.Graph
	vidx    *vectordb.Index
	tmpl    *template.Template
}

func NewServer(repo *storage.Repository, metrics *telemetry.Metrics, topo *graph.Graph, vidx *vectordb.Index) *Server {
	// Create template with custom functions
	tmpl := template.New("argus").Funcs(template.FuncMap{
		"text_uppercase": strings.ToUpper,
		"text_lowercase": strings.ToLower,
	})

	// Parse all templates from the embedded FS
	tmpl = template.Must(tmpl.ParseFS(content, "templates/*.html"))

	return &Server{
		repo:    repo,
		metrics: metrics,
		topo:    topo,
		vidx:    vidx,
		tmpl:    tmpl,
	}
}

func (s *Server) RegisterRoutes(mux *http.ServeMux) error {
	// Serve static files
	mux.Handle("/static/", http.FileServer(http.FS(content)))

	// UI Routes
	mux.HandleFunc("/", s.handleDashboard)
	mux.HandleFunc("/logs", s.handleLogs)
	mux.HandleFunc("/traces", s.handleTraces)
	mux.HandleFunc("/traces/", s.handleTraceDetail)
	mux.HandleFunc("/metrics", s.handleMetrics)
	mux.HandleFunc("/storage", s.handleStorage)
	mux.HandleFunc("/services", s.handleServices)

	return nil
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	traces, _ := s.repo.RecentTraces(10)
	summary, _ := s.repo.GetStats()
	health := s.metrics.GetHealthStats()

	err := s.tmpl.ExecuteTemplate(w, "dashboard.html", map[string]interface{}{
		"Title":       "Dashboard - Argus",
		"Traces":      traces,
		"Stats":       summary,
		"HealthStats": health,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	limit := 100 // default

	var logs []storage.Log
	var err error

	if query != "" {
		logs, err = s.repo.SearchLogs(query, limit)
	} else {
		logs, err = s.repo.RecentLogs(limit)
	}

	if err != nil {
		http.Error(w, "Failed to load logs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	err = s.tmpl.ExecuteTemplate(w, "logs.html", map[string]interface{}{
		"Title": "Logs - Argus",
		"Logs":  logs,
		"Query": query,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (s *Server) handleTraces(w http.ResponseWriter, r *http.Request) {
	traces, err := s.repo.RecentTraces(50)
	if err != nil {
		http.Error(w, "Failed to load traces: "+err.Error(), http.StatusInternalServerError)
		return
	}

	err = s.tmpl.ExecuteTemplate(w, "traces.html", map[string]interface{}{
		"Title":  "Traces - Argus",
		"Traces": traces,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (s *Server) handleTraceDetail(w http.ResponseWriter, r *http.Request) {
	traceID := strings.TrimPrefix(r.URL.Path, "/traces/")
	if traceID == "" {
		http.Redirect(w, r, "/traces", http.StatusFound)
		return
	}

	trace, err := s.repo.GetTrace(traceID)
	if err != nil {
		http.Error(w, "Trace not found", http.StatusNotFound)
		return
	}

	err = s.tmpl.ExecuteTemplate(w, "trace_detail.html", map[string]interface{}{
		"Title": "Trace: " + traceID + " - Argus",
		"Trace": trace,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	health := s.metrics.GetHealthStats()

	err := s.tmpl.ExecuteTemplate(w, "metrics.html", map[string]interface{}{
		"Title":       "Metrics - Argus",
		"HealthStats": health,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (s *Server) handleStorage(w http.ResponseWriter, r *http.Request) {
	stats, err := s.repo.GetStats()
	if err != nil {
		http.Error(w, "Failed to load storage stats: "+err.Error(), http.StatusInternalServerError)
		return
	}

	err = s.tmpl.ExecuteTemplate(w, "storage.html", map[string]interface{}{
		"Title": "Storage - Argus",
		"Stats": stats,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (s *Server) handleServices(w http.ResponseWriter, r *http.Request) {
	nodes := s.topo.GetNodes()

	err := s.tmpl.ExecuteTemplate(w, "services.html", map[string]interface{}{
		"Title": "Services - Argus",
		"Nodes": nodes,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
