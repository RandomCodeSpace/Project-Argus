#!/bin/bash
# ARGUS V5.0 Chaos Test Simulation
# Starts all 3 test services, runs load test, then cleanup

set -e

echo "================================"
echo " ARGUS V5.0 Chaos Simulation"
echo "================================"
echo ""

# Build services
echo "[1/4] Building test services..."
go build -o ./tmp/orderservice ./test/orderservice
go build -o ./tmp/paymentservice ./test/paymentservice
go build -o ./tmp/inventoryservice ./test/inventoryservice
go build -o ./tmp/authservice ./test/authservice
go build -o ./tmp/userservice ./test/userservice
go build -o ./tmp/shippingservice ./test/shippingservice
go build -o ./tmp/notificationservice ./test/notificationservice
echo "✅ All services built"

# Start services in background
echo "[2/4] Starting services..."
./tmp/userservice &
PID_USER=$!
sleep 1

./tmp/authservice &
PID_AUTH=$!
sleep 1

./tmp/inventoryservice &
PID_INVENTORY=$!
sleep 1

./tmp/shippingservice &
PID_SHIPPING=$!
sleep 1

./tmp/notificationservice &
PID_NOTIFICATION=$!
sleep 1

./tmp/paymentservice &
PID_PAYMENT=$!
sleep 1

./tmp/orderservice &
PID_ORDER=$!
sleep 1

echo "✅ All services started"
echo "  👤 User Service         (PID: $PID_USER)         → :9005"
echo "  🔐 Auth Service         (PID: $PID_AUTH)         → :9004"
echo "  📦 Inventory Service    (PID: $PID_INVENTORY)    → :9003"
echo "  🚚 Shipping Service     (PID: $PID_SHIPPING)     → :9006"
echo "  ✉️ Notification Service (PID: $PID_NOTIFICATION) → :9007"
echo "  💳 Payment Service      (PID: $PID_PAYMENT)      → :9002"
echo "  🛒 Order Service        (PID: $PID_ORDER)        → :9001"

# Cleanup on exit
cleanup() {
    echo ""
    echo "[4/4] Cleaning up..."
    kill $PID_ORDER $PID_PAYMENT $PID_INVENTORY $PID_AUTH $PID_USER $PID_SHIPPING $PID_NOTIFICATION 2>/dev/null || true
    rm -f ./tmp/orderservice ./tmp/paymentservice ./tmp/inventoryservice ./tmp/authservice ./tmp/userservice ./tmp/shippingservice ./tmp/notificationservice
    echo "✅ All services stopped"
}
trap cleanup EXIT INT TERM

# Run load test
echo ""
echo "[3/4] Running load test (60 seconds)..."
echo ""

TOTAL=0
SUCCESS=0
FAILURE=0

while true; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:9001/order 2>/dev/null || echo "000")
    TOTAL=$((TOTAL + 1))
    
    if [ "$STATUS" = "200" ]; then
        SUCCESS=$((SUCCESS + 1))
    else
        FAILURE=$((FAILURE + 1))
    fi
    
    # Print progress every 30 requests
    if [ $((TOTAL % 30)) -eq 0 ]; then
        echo "  📊 Progress: $TOTAL requests | ✅ $SUCCESS | ❌ $FAILURE"
    fi
    
    sleep 0.2
done

echo ""
echo "================================"
echo " Simulation Complete"
echo "================================"
echo " Total Requests: $TOTAL"
echo " Successful:     $SUCCESS"
echo " Failed:         $FAILURE"
echo " Error Rate:     $(echo "scale=1; $FAILURE * 100 / $TOTAL" | bc)%"
echo "================================"
