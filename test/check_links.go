package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

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

	fmt.Printf("Current System Time: %v\n", time.Now().Format(time.RFC3339))

	// 1. Most recent spans
	rows, _ := db.Query("SELECT start_time, service_name, operation_name FROM spans ORDER BY start_time DESC LIMIT 5")
	fmt.Println("\nMost recent spans:")
	for rows.Next() {
		var t time.Time
		var s, o string
		rows.Scan(&t, &s, &o)
		fmt.Printf("%s | %s | %s\n", t.Format(time.RFC3339), s, o)
	}

	// 2. Sample link
	rows, _ = db.Query(`
		SELECT s1.start_time, s1.service_name, s2.service_name
		FROM spans s1 
		JOIN spans s2 ON s1.parent_span_id = s2.span_id 
		WHERE s1.service_name != s2.service_name
		LIMIT 1
	`)
	fmt.Println("\nSample cross-service link:")
	for rows.Next() {
		var t time.Time
		var s1, s2 string
		rows.Scan(&t, &s1, &s2)
		fmt.Printf("TIME: %s | %s -> %s\n", t.Format(time.RFC3339), s2, s1)
	}
}
