package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/batuhanergun/ecole/api/internal/config"
	"github.com/batuhanergun/ecole/api/internal/queue"
	"github.com/batuhanergun/ecole/api/internal/server"
	"github.com/batuhanergun/ecole/api/internal/storage"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
	cfg := config.Load()

	if cfg.IsDevMode() {
		log.Println("Running in dev mode (no WorkOS auth)")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Run migrations
	migrationsPath := "file://migrations"
	if _, err := os.Stat("migrations"); os.IsNotExist(err) {
		migrationsPath = "file:///migrations"
	}
	m, err := migrate.New(migrationsPath, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to create migrator: %v", err)
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		log.Fatalf("Failed to run migrations: %v", err)
	}
	log.Println("Migrations complete")

	// Store
	s, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer s.Close()

	// Storage
	st, err := storage.New(cfg.StoragePath)
	if err != nil {
		log.Fatalf("Failed to create storage: %v", err)
	}

	// Queue
	q := queue.New(s.Pool())

	// Server
	r := server.New(cfg, s, st, q)

	// Background: reset stale claimed jobs every 5 minutes (30-min timeout)
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n, err := q.ResetStaleClaims(ctx, 30*time.Minute)
				if err != nil {
					log.Printf("ResetStaleClaims error: %v", err)
				} else if n > 0 {
					log.Printf("Reset %d stale claimed jobs", n)
				}
			}
		}
	}()

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		cancel()
	}()

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("Starting server on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
