package main

import (
	"database/sql"
	"log"
	"os"

	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	dsn := os.Getenv("DB_DSN")
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, _ = db.Exec("SET FOREIGN_KEY_CHECKS = 0")
	_, _ = db.Exec("TRUNCATE TABLE spans")
	_, _ = db.Exec("TRUNCATE TABLE traces")
	_, _ = db.Exec("TRUNCATE TABLE logs")
	_, _ = db.Exec("SET FOREIGN_KEY_CHECKS = 1")
	log.Println("Tables truncated.")
}
