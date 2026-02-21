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
			semconv.ServiceName("order-service"),
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

	tracer = otel.Tracer("order-service")

	mux := http.NewServeMux()
	mux.Handle("/order", otelhttp.NewHandler(http.HandlerFunc(handleOrder), "POST /order"))

	log.Println("🛒 Order Service listening on :9001")
	log.Fatal(http.ListenAndServe(":9001", mux))
}

func handleOrder(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "process_order")
	defer span.End()

	orderID := fmt.Sprintf("ORD-%d", rand.Intn(100000))
	span.SetAttributes(
		attribute.String("order.id", orderID),
	)
	span.AddEvent("order_received", trace.WithAttributes(attribute.String("order.id", orderID)))

	// Chaos: 30% chance of random latency (100-800ms)
	if rand.Intn(100) < 30 {
		latency := time.Duration(100+rand.Intn(700)) * time.Millisecond
		span.AddEvent("chaos_latency_injected", trace.WithAttributes(
			attribute.String("latency", latency.String()),
		))
		time.Sleep(latency)
	}

	// 1. Authenticate token
	span.AddEvent("verifying_user", trace.WithAttributes(attribute.String("upstream", "auth-service")))
	if err := callAuthService(ctx); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		http.Error(w, "Auth Failed: "+err.Error(), http.StatusUnauthorized)
		return
	}

	// 2. Call Payment Service (Service B)
	span.AddEvent("processing_payment", trace.WithAttributes(attribute.String("upstream", "payment-service")))
	if err := callPaymentService(ctx); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		http.Error(w, "Payment Failed: "+err.Error(), http.StatusBadGateway)
		return
	}

	// 3. Dispatch Shipping
	span.AddEvent("dispatching_shipment", trace.WithAttributes(attribute.String("upstream", "shipping-service")))
	if err := callShippingService(ctx); err != nil {
		span.RecordError(err)
		span.AddEvent("shipping_delayed", trace.WithAttributes(attribute.String("warning", err.Error())))
		// Continue anyway (soft failure map)
	}

	// 4. Send Notification
	span.AddEvent("sending_notification", trace.WithAttributes(attribute.String("upstream", "notification-service")))
	if err := callNotificationService(ctx); err != nil {
		span.RecordError(err)
		// Best effort, don't fail transaction
	}

	span.AddEvent("order_completed", trace.WithAttributes(attribute.String("status", "success")))
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Order Placed Successfully"))
}

func callAuthService(ctx context.Context) error {
	client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}

	req, err := http.NewRequestWithContext(ctx, "POST", "http://localhost:9004/validate", nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("auth service returned %d", resp.StatusCode)
	}
	return nil
}

func callPaymentService(ctx context.Context) error {
	client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}

	req, err := http.NewRequestWithContext(ctx, "POST", "http://localhost:9002/pay", nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("payment service returned %d", resp.StatusCode)
	}
	return nil
}

func callShippingService(ctx context.Context) error {
	client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}
	req, _ := http.NewRequestWithContext(ctx, "POST", "http://localhost:9006/ship", nil)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("shipping failed: %d", resp.StatusCode)
	}
	return nil
}

func callNotificationService(ctx context.Context) error {
	client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}
	req, _ := http.NewRequestWithContext(ctx, "POST", "http://localhost:9007/notify", nil)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("notification failed: %d", resp.StatusCode)
	}
	return nil
}
