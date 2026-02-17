package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/RandomCodeSpace/Project-Argus/internal/ai"
	"github.com/RandomCodeSpace/Project-Argus/internal/api"
	"github.com/RandomCodeSpace/Project-Argus/internal/config"
	"github.com/RandomCodeSpace/Project-Argus/internal/ingest"
	"github.com/RandomCodeSpace/Project-Argus/internal/storage"
	"github.com/RandomCodeSpace/Project-Argus/web"

	collogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

func main() {
	printBanner()

	// 0. Load Configuration
	cfg := config.Load()
	log.Printf("🚀 Starting Argus in %s mode", cfg.Env)

	// 1. Initialize Storage
	// repository.go already reads DB_DRIVER and DB_DSN from env,
	// which godotenv has now populated.
	repo, err := storage.NewRepository()
	if err != nil {
		log.Fatalf("Failed to initialize repository: %v", err)
	}

	// 2. Initialize AI Service
	aiService := ai.NewService(repo)
	defer aiService.Stop()

	// 3. Initialize API Server
	apiServer := api.NewServer(repo)

	// 4. Initialize OTLP Ingestion (gRPC)
	traceServer := ingest.NewTraceServer(repo)
	logsServer := ingest.NewLogsServer(repo)

	// Wire up live log streaming
	// When a log arrives, ingest -> api.BroadcastLog
	logHandler := func(l storage.Log) {
		start := time.Now()
		apiServer.BroadcastLog(l)
		// AI Analysis Trigger
		aiService.EnqueueLog(l)
		if time.Since(start) > 100*time.Millisecond {
			log.Println("Slow broadcast/enqueue took", time.Since(start))
		}
	}

	logsServer.SetLogCallback(logHandler)
	traceServer.SetLogCallback(logHandler)

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
		log.Printf("Starting gRPC OTLP receiver on :%s", cfg.GRPCPort)
		if err := grpcServer.Serve(lis); err != nil {
			log.Fatalf("Failed to serve gRPC: %v", err)
		}
	}()

	// 5. Start HTTP Server
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
			// File exists, serve it
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// File does not exist, serve index.html (SPA catch-all)
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
		log.Printf("Starting HTTP Server on :%s", cfg.HTTPPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	// 6. Graceful Shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("Shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	grpcServer.GracefulStop()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("HTTP server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

func printBanner() {
	banner := `
    _    ____   ____ _   _ ____   __     ______  
   / \  |  _ \ / ___| | | / ___|  \ \   / /___ \ 
  / _ \ | |_) | |  _| | | \___ \   \ \ / /  __) |
 / ___ \|  _ <| |_| | |_| |___) |   \ V /  / __/ 
/_/   \_\_| \_\\____|\___/|____/     \_/  |_____|

Project ARGUS V2: Enterprise Edition - All Systems Nominal
`
	fmt.Println(banner)
}
