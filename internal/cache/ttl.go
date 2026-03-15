package cache

import (
	"sync"
	"time"
)

type entry struct {
	value     interface{}
	expiresAt time.Time
}

// TTLCache is a simple in-memory cache with per-entry TTL expiry.
// Safe for concurrent use. Background goroutine evicts stale entries every 30s.
type TTLCache struct {
	mu    sync.RWMutex
	items map[string]entry
}

// New creates a new TTLCache and starts the background eviction loop.
func New() *TTLCache {
	c := &TTLCache{items: make(map[string]entry)}
	go c.evictLoop()
	return c
}

// Set stores value under key with the given TTL.
func (c *TTLCache) Set(key string, value interface{}, ttl time.Duration) {
	c.mu.Lock()
	c.items[key] = entry{value: value, expiresAt: time.Now().Add(ttl)}
	c.mu.Unlock()
}

// Get returns the cached value and true if it exists and has not expired.
func (c *TTLCache) Get(key string) (interface{}, bool) {
	c.mu.RLock()
	e, ok := c.items[key]
	c.mu.RUnlock()
	if !ok || time.Now().After(e.expiresAt) {
		return nil, false
	}
	return e.value, true
}

// Delete removes a key immediately.
func (c *TTLCache) Delete(key string) {
	c.mu.Lock()
	delete(c.items, key)
	c.mu.Unlock()
}

// evictLoop removes expired entries every 30 seconds.
func (c *TTLCache) evictLoop() {
	ticker := time.NewTicker(30 * time.Second)
	for range ticker.C {
		now := time.Now()
		c.mu.Lock()
		for k, e := range c.items {
			if now.After(e.expiresAt) {
				delete(c.items, k)
			}
		}
		c.mu.Unlock()
	}
}
