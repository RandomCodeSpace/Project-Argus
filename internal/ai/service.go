package ai

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/argus-project/argus/internal/storage"
	"github.com/tmc/langchaingo/llms"
	"github.com/tmc/langchaingo/llms/openai"
)

type Service struct {
	repo       *storage.Repository
	llm        llms.Model
	enabled    bool
	workQueue  chan storage.Log
	workerPool int
	wg         sync.WaitGroup
}

func NewService(repo *storage.Repository) *Service {
	enabled := os.Getenv("AI_ENABLED") == "true"
	if !enabled {
		return &Service{enabled: false}
	}

	// Initialize Azure OpenAI
	// Using generic openai driver which supports Azure via base URL
	opts := []openai.Option{
		openai.WithAPIType(openai.APITypeAzure),
		openai.WithBaseURL(os.Getenv("AZURE_OPENAI_ENDPOINT")),
		openai.WithToken(os.Getenv("AZURE_OPENAI_KEY")),
		openai.WithModel(os.Getenv("AZURE_OPENAI_MODEL")),
		// The deployment name is often mapped to model in Azure SDKs or needs explicit handling
		// langchaingo's openai adapter handles this via BaseURL/Model usually.
		// DeploymentName might be needed depending on the library version.
		// We'll assume standard env vars work for now or basic setup.
	}

	// If using a specific deployment name as model
	if deployment := os.Getenv("AZURE_OPENAI_DEPLOYMENT"); deployment != "" {
		opts = append(opts, openai.WithModel(deployment))
	}

	// If API version is needed
	if apiVersion := os.Getenv("AZURE_OPENAI_API_VERSION"); apiVersion != "" {
		opts = append(opts, openai.WithAPIVersion(apiVersion))
	}

	llm, err := openai.New(opts...)
	if err != nil {
		log.Printf("Failed to initialize AI service: %v. AI features disabled.", err)
		return &Service{enabled: false}
	}

	queueSize := 100
	workerPool := 3

	s := &Service{
		repo:       repo,
		llm:        llm,
		enabled:    true,
		workQueue:  make(chan storage.Log, queueSize),
		workerPool: workerPool,
	}

	s.startWorkers()
	return s
}

func (s *Service) startWorkers() {
	for i := 0; i < s.workerPool; i++ {
		s.wg.Add(1)
		go func(workerID int) {
			defer s.wg.Done()
			for logEntry := range s.workQueue {
				s.analyzeLog(context.Background(), logEntry)
			}
		}(i)
	}
}

func (s *Service) Stop() {
	if !s.enabled {
		return
	}
	close(s.workQueue)
	s.wg.Wait()
}

// EnqueueLog adds a log to the analysis queue if it meets criteria.
func (s *Service) EnqueueLog(l storage.Log) {
	if !s.enabled {
		return
	}
	// Simple criteria: Severity is ERROR or CRITICAL
	// Adjust string check to match OTLP mapping
	severity := strings.ToUpper(l.Severity)
	if strings.Contains(severity, "ERROR") || strings.Contains(severity, "CRITICAL") || strings.Contains(severity, "FATAL") {
		select {
		case s.workQueue <- l:
		default:
			// Drop if queue full to avoid blocking ingestion
			log.Println("AI work queue full, dropping log analysis")
		}
	}
}

func (s *Service) analyzeLog(ctx context.Context, l storage.Log) {
	// Create a prompt
	prompt := fmt.Sprintf(`Analyze the following error log and provide a brief, actionable insight (max 2 sentences).
	
	Service: %s
	Timestamp: %s
	Severity: %s
	Body: %s
	Attributes: %s
	
	Insight:`, l.ServiceName, l.Timestamp, l.Severity, l.Body, l.AttributesJSON)

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	completion, err := llms.GenerateFromSinglePrompt(ctx, s.llm, prompt)
	if err != nil {
		log.Printf("AI Analysis failed for log %d: %v", l.ID, err)
		return
	}

	insight := strings.TrimSpace(completion)
	if insight == "" {
		return
	}

	if err := s.repo.UpdateLogInsight(l.ID, insight); err != nil {
		log.Printf("Failed to save AI insight for log %d: %v", l.ID, err)
	}
}
