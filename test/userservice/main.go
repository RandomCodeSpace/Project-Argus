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
			semconv.ServiceName("user-service"),
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

	tracer = otel.Tracer("user-service")

	mux := http.NewServeMux()
	mux.Handle("/user", otelhttp.NewHandler(http.HandlerFunc(handleUserFetch), "GET /user"))

	log.Println("👤 User Service listening on :9005")
	log.Fatal(http.ListenAndServe(":9005", mux))
}

func handleUserFetch(w http.ResponseWriter, r *http.Request) {
	_, span := tracer.Start(r.Context(), "fetch_user_profile")
	defer span.End()

	// Chaos: High error rate simulate cache miss + DB timeout
	if rand.Intn(100) < 15 {
		err := fmt.Errorf("redis cache timeout")
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		span.AddEvent("cache_failure", trace.WithAttributes(attribute.String("error", err.Error())))

		http.Error(w, "User Not Found", http.StatusServiceUnavailable)
		return
	}

	span.AddEvent("cache_hit", trace.WithAttributes(attribute.String("user.id", "usr_123")))
	time.Sleep(10 * time.Millisecond) // Fast response

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status": "active", "id": "usr_123"}`))
}
