package storage

import (
	"time"

	"gorm.io/gorm"
)

// Trace represents a complete distributed trace.
type Trace struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	TraceID     string         `gorm:"uniqueIndex;size:32;not null" json:"trace_id"`
	ServiceName string         `gorm:"size:255;index" json:"service_name"`
	Duration    int64          `gorm:"index" json:"duration"` // Microseconds
	DurationMs  float64        `gorm:"-" json:"duration_ms"`
	SpanCount   int            `gorm:"-" json:"span_count"`
	Operation   string         `gorm:"-" json:"operation"`
	Status      string         `gorm:"size:50" json:"status"`
	Timestamp   time.Time      `gorm:"index" json:"timestamp"`
	Spans       []Span         `gorm:"foreignKey:TraceID;references:TraceID;constraint:false" json:"spans,omitempty"`
	Logs        []Log          `gorm:"foreignKey:TraceID;references:TraceID;constraint:false" json:"logs,omitempty"`
	CreatedAt   time.Time      `json:"-"`
	UpdatedAt   time.Time      `json:"-"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

// Span represents a single operation within a trace.
type Span struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	TraceID        string    `gorm:"index;size:32;not null" json:"trace_id"`
	SpanID         string    `gorm:"size:16;not null" json:"span_id"`
	ParentSpanID   string    `gorm:"size:16" json:"parent_span_id"`
	OperationName  string    `gorm:"size:255;index" json:"operation_name"`
	StartTime      time.Time `json:"start_time"`
	EndTime        time.Time `json:"end_time"`
	Duration       int64     `json:"duration"`                           // Microseconds
	ServiceName    string    `gorm:"size:255;index" json:"service_name"` // Originating service
	AttributesJSON string    `gorm:"type:text" json:"attributes_json"`   // Stored as JSON string
}

// Log represents a log entry associated with a trace.
type Log struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	TraceID        string    `gorm:"index;size:32" json:"trace_id"`
	SpanID         string    `gorm:"size:16" json:"span_id"`
	Severity       string    `gorm:"size:50;index" json:"severity"`
	Body           string    `gorm:"type:text" json:"body"`
	ServiceName    string    `gorm:"size:255;index" json:"service_name"`
	AttributesJSON string    `gorm:"type:text" json:"attributes_json"`
	AIInsight      string    `gorm:"type:text" json:"ai_insight"` // Populated by AI analysis
	Timestamp      time.Time `gorm:"index" json:"timestamp"`
}
