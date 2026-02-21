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
			semconv.ServiceName("notification-service"),
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

	tracer = otel.Tracer("notification-service")

	mux := http.NewServeMux()
	mux.Handle("/notify", otelhttp.NewHandler(http.HandlerFunc(handleNotification), "POST /notify"))

	log.Println("✉️ Notification Service listening on :9007")
	log.Fatal(http.ListenAndServe(":9007", mux))
}

func handleNotification(w http.ResponseWriter, r *http.Request) {
	_, span := tracer.Start(r.Context(), "send_email_receipt")
	defer span.End()

	span.SetAttributes(attribute.String("channel", "email"))
	time.Sleep(15 * time.Millisecond)

	// Rarely fails independently
	if rand.Intn(100) < 2 {
		err := fmt.Errorf("smtp server rejected connection")
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		http.Error(w, "SMTP Error", http.StatusInternalServerError)
		return
	}

	span.AddEvent("email_dispatched")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status": "queued"}`))
}
