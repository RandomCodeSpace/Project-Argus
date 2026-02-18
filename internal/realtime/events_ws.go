package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/RandomCodeSpace/Project-Argus/internal/storage"
	"github.com/coder/websocket"
)

// LiveSnapshot is the data payload pushed to all event WS clients.
type LiveSnapshot struct {
	Type       string                     `json:"type"`
	Dashboard  *storage.DashboardStats    `json:"dashboard"`
	Traffic    []storage.TrafficPoint     `json:"traffic"`
	Traces     *storage.TracesResponse    `json:"traces"`
	ServiceMap *storage.ServiceMapMetrics `json:"service_map"`
}

// clientFilter tracks a client's active service filter.
// Empty string = all services (no filter).
type clientFilter struct {
	service string
}

// EventHub manages WebSocket clients and pushes live data snapshots
// filtered per-client's selected service. Debounces rapid ingestion
// bursts and only computes snapshots every flush interval.
type EventHub struct {
	repo   *storage.Repository
	onConn func()
	onDisc func()

	mu      sync.Mutex
	clients map[*websocket.Conn]*clientFilter
	pending bool
}

// NewEventHub creates a new event notification hub.
func NewEventHub(repo *storage.Repository, onConnect, onDisconnect func()) *EventHub {
	return &EventHub{
		repo:    repo,
		onConn:  onConnect,
		onDisc:  onDisconnect,
		clients: make(map[*websocket.Conn]*clientFilter),
	}
}

// Start begins the periodic flush loop. Call in a goroutine.
func (h *EventHub) Start(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.flush()
		}
	}
}

// NotifyRefresh marks that new data has arrived. The actual broadcast
// happens on the next ticker flush to debounce rapid ingestion bursts.
func (h *EventHub) NotifyRefresh() {
	h.mu.Lock()
	h.pending = true
	h.mu.Unlock()
}

// HandleWebSocket upgrades an HTTP request to a WebSocket connection,
// registers it as an event client, and listens for filter messages.
func (h *EventHub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		slog.Error("Event WS accept failed", "error", err)
		return
	}

	// Check for initial service filter from query params
	initialService := r.URL.Query().Get("service")
	h.addClient(conn, initialService)

	// Send immediate snapshot so the client has data right away
	h.sendSnapshotTo(conn, initialService)

	// Read loop: client can send {"service":"xxx"} to change filter
	for {
		_, msg, readErr := conn.Read(r.Context())
		if readErr != nil {
			break
		}
		var filterMsg struct {
			Service string `json:"service"`
		}
		if json.Unmarshal(msg, &filterMsg) == nil {
			h.updateClientFilter(conn, filterMsg.Service)
		}
	}

	h.removeClient(conn)
	conn.Close(websocket.StatusNormalClosure, "bye")
}

func (h *EventHub) addClient(c *websocket.Conn, service string) {
	h.mu.Lock()
	h.clients[c] = &clientFilter{service: service}
	h.mu.Unlock()
	if h.onConn != nil {
		h.onConn()
	}
}

func (h *EventHub) removeClient(c *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	if h.onDisc != nil {
		h.onDisc()
	}
}

func (h *EventHub) updateClientFilter(c *websocket.Conn, service string) {
	h.mu.Lock()
	if cf, ok := h.clients[c]; ok {
		cf.service = service
	}
	h.mu.Unlock()
}

// flush computes per-service snapshots and pushes to matching clients.
func (h *EventHub) flush() {
	h.mu.Lock()
	if !h.pending {
		h.mu.Unlock()
		return
	}
	h.pending = false

	if len(h.clients) == 0 {
		h.mu.Unlock()
		return
	}

	// Group clients by service filter
	groups := make(map[string][]*websocket.Conn)
	for c, cf := range h.clients {
		groups[cf.service] = append(groups[cf.service], c)
	}
	h.mu.Unlock()

	// Compute one snapshot per unique filter, push to matching clients
	for service, clients := range groups {
		snapshot := h.computeSnapshot(service)
		if snapshot == nil {
			continue
		}
		msg, err := json.Marshal(snapshot)
		if err != nil {
			slog.Error("Event WS marshal failed", "error", err)
			continue
		}

		for _, conn := range clients {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			if err := conn.Write(ctx, websocket.MessageText, msg); err != nil {
				slog.Debug("Event WS send failed, removing client", "error", err)
				h.removeClient(conn)
				conn.Close(websocket.StatusGoingAway, "write error")
			}
			cancel()
		}
	}
}

// sendSnapshotTo sends a snapshot to a single client.
func (h *EventHub) sendSnapshotTo(conn *websocket.Conn, service string) {
	snapshot := h.computeSnapshot(service)
	if snapshot == nil {
		return
	}
	msg, err := json.Marshal(snapshot)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn.Write(ctx, websocket.MessageText, msg)
}

// computeSnapshot queries the DB for the last 15 minutes of data,
// optionally filtered by a single service name.
func (h *EventHub) computeSnapshot(service string) *LiveSnapshot {
	now := time.Now()
	start := now.Add(-15 * time.Minute)

	var serviceNames []string
	if service != "" {
		serviceNames = []string{service}
	}

	snapshot := &LiveSnapshot{Type: "live_snapshot"}

	if stats, err := h.repo.GetDashboardStats(start, now, serviceNames); err == nil {
		snapshot.Dashboard = stats
	}

	if traffic, err := h.repo.GetTrafficMetrics(start, now, serviceNames); err == nil {
		snapshot.Traffic = traffic
	}

	if traces, err := h.repo.GetTracesFiltered(start, now, serviceNames, "", "", 25, 0, "timestamp", "desc"); err == nil {
		snapshot.Traces = traces
	}

	if smap, err := h.repo.GetServiceMapMetrics(start, now); err == nil {
		snapshot.ServiceMap = smap
	}

	return snapshot
}
