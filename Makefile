.PHONY: dev dev-web dev-api dev-worker db migrate up down clean

# Start all services via Docker Compose
up:
	docker compose up -d

down:
	docker compose down

# Development (run each service locally)
dev-db:
	docker compose up -d db

dev-api:
	cd api && go run ./cmd/server

dev-web:
	cd web && pnpm dev

dev-worker:
	cd worker && python -m worker.main

# Database
migrate:
	cd api && go run ./cmd/server --migrate

# Build
build-api:
	cd api && go build -o bin/server ./cmd/server

build-web:
	cd web && pnpm build

# Clean
clean:
	docker compose down -v
	rm -rf api/bin
	rm -rf web/dist
