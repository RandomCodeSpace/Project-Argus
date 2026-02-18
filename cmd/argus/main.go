package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/RandomCodeSpace/Project-Argus/internal/ai"
	"github.com/RandomCodeSpace/Project-Argus/internal/api"
	"github.com/RandomCodeSpace/Project-Argus/internal/config"
	"github.com/RandomCodeSpace/Project-Argus/internal/ingest"
	"github.com/RandomCodeSpace/Project-Argus/internal/queue"
	"github.com/RandomCodeSpace/Project-Argus/internal/realtime"
	"github.com/RandomCodeSpace/Project-Argus/internal/storage"
	"github.com/RandomCodeSpace/Project-Argus/internal/telemetry"
	"github.com/RandomCodeSpace/Project-Argus/web"

	collogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc"
	_ "google.golang.org/grpc/encoding/gzip" // Register gzip decompressor
	"google.golang.org/grpc/reflection"
)

func main() {
	// Force UTC timezone globally — prevents system timezone leaking into timestamps
	time.Local = time.UTC

	printBanner()

	// 0. Load Configuration
	cfg := config.Load()

	// Initialize structured logger
	var level slog.Level
	switch strings.ToUpper(cfg.LogLevel) {
	case "DEBUG":
		level = slog.LevelDebug
	case "WARN":
		level = slog.LevelWarn
	case "ERROR":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	}))
	slog.SetDefault(logger)

	slog.Info("🚀 Starting Argus V5.0", "env", cfg.Env, "log_level", level)

	// 1. Initialize Internal Telemetry (first — everything registers metrics against this)
	metrics := telemetry.New()
	slog.Info("📊 Internal telemetry initialized")

	// 2. Initialize Storage
	repo, err := storage.NewRepository(metrics)
	if err != nil {
		log.Fatalf("Failed to initialize repository: %v", err)
	}
	slog.Info("💾 Storage initialized", "driver", cfg.DBDriver)

	// 3. Initialize DLQ (Dead Letter Queue)
	replayInterval, err := time.ParseDuration(cfg.DLQReplayInterval)
	if err != nil {
		replayInterval = 5 * time.Minute
	}

	dlq, err := queue.NewDLQ(cfg.DLQPath, replayInterval, func(data []byte) error {
		// Replay handler: try to deserialize and re-insert logs
		var logs []storage.Log
		if err := json.Unmarshal(data, &logs); err != nil {
			return fmt.Errorf("DLQ replay unmarshal failed: %w", err)
		}
		return repo.BatchCreateLogs(logs)
	})
	if err != nil {
		log.Fatalf("Failed to initialize DLQ: %v", err)
	}
	defer dlq.Stop()
	slog.Info("🔁 DLQ initialized", "path", cfg.DLQPath, "interval", replayInterval)

	// 4. Initialize Real-Time WebSocket Hub
	hub := realtime.NewHub(func(count int) {
		metrics.SetActiveConnections(count)
	})
	go hub.Run()
	defer hub.Stop()
	slog.Info("🔌 WebSocket hub started")

	// 4b. Initialize Event Notification Hub (for live mode — pushes data snapshots)
	eventHub := realtime.NewEventHub(
		repo,
		metrics.IncrementActiveConns,
		metrics.DecrementActiveConns,
	)
	ctxEvents, cancelEvents := context.WithCancel(context.Background())
	defer cancelEvents()
	go eventHub.Start(ctxEvents, 5*time.Second)
	slog.Info("⚡ Event notification hub started (5s flush)")

	// 5. Initialize AI Service
	aiService := ai.NewService(repo)
	defer aiService.Stop()

	// 6. Initialize API Server
	apiServer := api.NewServer(repo, hub, eventHub, metrics)

	// 7. Initialize OTLP Ingestion (gRPC)
	traceServer := ingest.NewTraceServer(repo, metrics, cfg)
	logsServer := ingest.NewLogsServer(repo, metrics, cfg)

	// Wire up live log streaming + AI + DLQ metrics
	logHandler := func(l storage.Log) {
		start := time.Now()
		apiServer.BroadcastLog(l)
		aiService.EnqueueLog(l)
		eventHub.NotifyRefresh()
		if time.Since(start) > 100*time.Millisecond {
			slog.Warn("Slow broadcast/enqueue", "duration", time.Since(start))
		}
	}

	logsServer.SetLogCallback(logHandler)
	traceServer.SetLogCallback(logHandler)

	// Update DLQ size metric periodically
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				metrics.SetDLQSize(dlq.Size())
			}
		}
	}()

	// Start gRPC Server
	lis, err := net.Listen("tcp", ":"+cfg.GRPCPort)
	if err != nil {
		log.Fatalf("Failed to listen on :%s: %v", cfg.GRPCPort, err)
	}
	grpcServer := grpc.NewServer()
	coltracepb.RegisterTraceServiceServer(grpcServer, traceServer)
	collogspb.RegisterLogsServiceServer(grpcServer, logsServer)
	reflection.Register(grpcServer)

	go func() {
		slog.Info("📡 gRPC OTLP receiver started", "port", cfg.GRPCPort)
		if err := grpcServer.Serve(lis); err != nil {
			log.Fatalf("Failed to serve gRPC: %v", err)
		}
	}()

	// 8. Start HTTP Server
	mux := http.NewServeMux()
	apiServer.RegisterRoutes(mux)

	// SPA Handler
	distFS, err := web.DistFS()
	if err != nil {
		log.Fatalf("Failed to load embedded frontend: %v", err)
	}
	fileServer := http.FileServer(http.FS(distFS))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "index.html"
		} else if path[0] == '/' {
			path = path[1:]
		}

		f, err := distFS.Open(path)
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA catch-all → serve index.html
		f, err = distFS.Open("index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusInternalServerError)
			return
		}
		defer f.Close()

		stat, _ := f.Stat()
		http.ServeContent(w, r, "index.html", stat.ModTime(), f.(interface {
			Read(p []byte) (n int, err error)
			Seek(offset int64, whence int) (int64, error)
		}))
	})

	srv := &http.Server{
		Addr:    ":" + cfg.HTTPPort,
		Handler: mux,
	}

	go func() {
		slog.Info("🌐 HTTP server started", "port", cfg.HTTPPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	// 9. Graceful Shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	slog.Info("Shutting down ARGUS V5.0...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	grpcServer.GracefulStop()
	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("HTTP server forced shutdown", "error", err)
	}

	slog.Info("✅ ARGUS V5.0 shutdown complete")
}

func printBanner() {
	banner := `
     _    ____   ____ _   _ ____   __     _____  ___  
    / \  |  _ \ / ___| | | / ___|  \ \   / / ___|| _ \ 
   / _ \ | |_) | |  _| | | \___ \   \ \ / /|___ \| | | |
  / ___ \|  _ <| |_| | |_| |___) |   \ V /  ___) | |_| |
 /_/   \_\_| \_\\____|\\___/|____/     \_/  |____/|___/ 

 ARGUS V5.0 (DEV MODE) — Production Hardened Edition
 The Eye That Never Sleeps 👁️
`
	fmt.Println(banner)
}
