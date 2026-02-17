package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Env      string
	HTTPPort string
	GRPCPort string
	DBDriver string
	DBDSN    string
}

func Load() *Config {
	envFile := ".env"

	// Check if .env exists in current directory, otherwise try to find root
	if _, err := os.Stat(envFile); os.IsNotExist(err) {
		// Attempt to find .env by walking up logic (simplified for standard layout)
		// For now, assume running from root or .env is in root.
		// If running standard `go run cmd/server/main.go`, CWD is root.
	}

	if err := godotenv.Load(envFile); err != nil {
		log.Println("⚠️  No .env file found or failed to load, using system environment variables or defaults")
	} else {
		log.Println("✅ Loaded configuration from .env")
	}

	return &Config{
		Env:      getEnv("APP_ENV", "development"),
		HTTPPort: getEnv("HTTP_PORT", "8080"),
		GRPCPort: getEnv("GRPC_PORT", "4317"),
		DBDriver: getEnv("DB_DRIVER", "mysql"),
		DBDSN:    getEnv("DB_DSN", "root:admin@tcp(127.0.0.1:3306)/argus?charset=utf8mb4&parseTime=True&loc=Local"),
	}
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}
