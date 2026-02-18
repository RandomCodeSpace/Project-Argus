package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		log.Fatal("DB_DSN not set")
	}

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	rows, err := db.Query("SELECT trace_id, span_id, parent_span_id, service_name, operation_name FROM spans LIMIT 20")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	fmt.Printf("%-32s | %-16s | %-16s | %-15s | %s\n", "TraceID", "SpanID", "ParentID", "Service", "Operation")
	fmt.Println(string(make([]byte, 100)))
	for rows.Next() {
		var tid, sid, pid, svc, op string
		rows.Scan(&tid, &sid, &pid, &svc, &op)
		fmt.Printf("%-32s | %-16s | %-16s | %-15s | %s\n", tid, sid, pid, svc, op)
	}
}
