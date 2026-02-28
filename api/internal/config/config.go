package config

import "os"

type Config struct {
	Port          string
	DatabaseURL   string
	StoragePath   string
	CORSOrigin    string
	EncryptionKey string
	WorkOSAPIKey  string
	WorkOSClientID string
}

func Load() *Config {
	return &Config{
		Port:           getEnv("PORT", "8080"),
		DatabaseURL:    getEnv("DATABASE_URL", "postgres://ecole:ecole_dev@localhost:5432/ecole?sslmode=disable"),
		StoragePath:    getEnv("STORAGE_PATH", "./data/uploads"),
		CORSOrigin:     getEnv("CORS_ORIGIN", "http://localhost:5173"),
		EncryptionKey:  getEnv("ENCRYPTION_KEY", "dev-encryption-key-change-in-prod"),
		WorkOSAPIKey:   os.Getenv("WORKOS_API_KEY"),
		WorkOSClientID: os.Getenv("WORKOS_CLIENT_ID"),
	}
}

func (c *Config) IsDevMode() bool {
	return c.WorkOSAPIKey == ""
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
