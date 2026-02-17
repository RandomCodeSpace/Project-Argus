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
			semconv.ServiceName("payment-service"),
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

	tracer = otel.Tracer("payment-service")

	mux := http.NewServeMux()
	mux.Handle("/pay", otelhttp.NewHandler(http.HandlerFunc(handlePay), "POST /pay"))

	log.Println("Payment Service listening on :9002")
	log.Fatal(http.ListenAndServe(":9002", mux))
}

func handlePay(w http.ResponseWriter, r *http.Request) {
	_, span := tracer.Start(r.Context(), "process_payment")
	defer span.End()

	// Chaos: 20% chance of Gateway Timeout
	if rand.Intn(100) < 20 {
		err := fmt.Errorf("Gateway Timeout: Upstream Provider Unreachable")
		span.RecordError(err)
		span.SetAttributes(attribute.String("error.type", "payment_gateway_timeout"))
		span.SetStatus(codes.Error, err.Error())
		http.Error(w, err.Error(), http.StatusGatewayTimeout)
		return
	}

	time.Sleep(50 * time.Millisecond) // Simulating work
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Payment Processed"))
}
