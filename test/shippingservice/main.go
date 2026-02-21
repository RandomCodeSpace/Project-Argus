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
			semconv.ServiceName("shipping-service"),
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

	tracer = otel.Tracer("shipping-service")

	mux := http.NewServeMux()
	mux.Handle("/ship", otelhttp.NewHandler(http.HandlerFunc(handleShipping), "POST /ship"))

	log.Println("🚚 Shipping Service listening on :9006")
	log.Fatal(http.ListenAndServe(":9006", mux))
}

func handleShipping(w http.ResponseWriter, r *http.Request) {
	_, span := tracer.Start(r.Context(), "dispatch_shipment")
	defer span.End()

	span.SetAttributes(attribute.String("carrier", "fedex"))

	// Shipping is notoriously slow, sleep between 200ms and 1500ms
	latency := time.Duration(200+rand.Intn(1300)) * time.Millisecond
	time.Sleep(latency)
	span.AddEvent("third_party_api_call", trace.WithAttributes(attribute.String("api", "fedex_dispatch"), attribute.String("latency", latency.String())))

	if rand.Intn(100) < 5 {
		err := fmt.Errorf("carrier api timeout")
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		http.Error(w, "Failed to Dispatch", http.StatusGatewayTimeout)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"tracking_id": "FDX-88219"}`))
}
