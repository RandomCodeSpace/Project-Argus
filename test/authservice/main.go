package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.opentelemetry.io/otel/trace"
)

var tracer trace.Tracer

func initTracer() func(context.Context) error {
	ctx := context.Background()

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName("auth-service"),
		),
	)
	if err != nil {
		log.Fatalf("failed to create resource: %v", err)
	}

	traceClient := otlptracegrpc.NewClient(
		otlptracegrpc.WithInsecure(),
		otlptracegrpc.WithEndpoint("localhost:4317"),
	)

	exporter, err := otlptrace.New(ctx, traceClient)
	if err != nil {
		log.Fatalf("failed to create trace exporter: %v", err)
	}

	bsp := sdktrace.NewBatchSpanProcessor(exporter)
	tracerProvider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithResource(res),
		sdktrace.WithSpanProcessor(bsp),
	)
	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	return tracerProvider.Shutdown
}

func main() {
	shutdown := initTracer()
	defer shutdown(context.Background())

	tracer = otel.Tracer("auth-service")

	mux := http.NewServeMux()
	mux.Handle("/validate", otelhttp.NewHandler(http.HandlerFunc(handleValidate), "POST /validate"))

	log.Println("🔐 Auth Service listening on :9004")
	log.Fatal(http.ListenAndServe(":9004", mux))
}

func handleValidate(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "validate_token")
	defer span.End()

	// 1. Simulate Token Parse Delay
	time.Sleep(30 * time.Millisecond)

	// Chaos: 5% chance of bad token
	if rand.Intn(100) < 5 {
		err := fmt.Errorf("token signature invalid")
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		span.AddEvent("validation_failed", trace.WithAttributes(attribute.String("reason", "expired_signature")))
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// 2. Call User Service (Service E)
	span.AddEvent("checking_user_profile", trace.WithAttributes(attribute.String("upstream", "user-service")))
	if err := callUserService(ctx); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		http.Error(w, "Forbidden: "+err.Error(), http.StatusForbidden)
		return
	}

	span.AddEvent("token_validated", trace.WithAttributes(attribute.String("status", "success")))
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Authorized"))
}

func callUserService(ctx context.Context) error {
	client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}

	req, err := http.NewRequestWithContext(ctx, "GET", "http://localhost:9005/user", nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("user profile rejected: %d", resp.StatusCode)
	}
	return nil
}
