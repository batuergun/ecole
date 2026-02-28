package server

import (
	"github.com/batuhanergun/ecole/api/internal/config"
	"github.com/batuhanergun/ecole/api/internal/handler"
	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/queue"
	"github.com/batuhanergun/ecole/api/internal/storage"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
)

func New(cfg *config.Config, s *store.Store, st *storage.Storage, q *queue.Queue) *gin.Engine {
	r := gin.Default()
	r.Use(middleware.CORS(cfg.CORSOrigin))

	// Health check
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Handlers
	authH := handler.NewAuthHandler(s)
	projectH := handler.NewProjectHandler(s)
	uploadH := handler.NewUploadHandler(s, st)
	datasetH := handler.NewDatasetHandler(s)
	harnessH := handler.NewHarnessHandler(s, q)
	trainingH := handler.NewTrainingHandler(s, q)
	benchmarkH := handler.NewBenchmarkHandler(s, q)
	workerH := handler.NewWorkerHandler(s, q)
	settingsH := handler.NewSettingsHandler()

	// Auth routes (no auth middleware)
	auth := r.Group("/api/auth")
	{
		auth.GET("/me", middleware.Auth(cfg, s), authH.Me)
	}

	// Protected routes
	api := r.Group("/api", middleware.Auth(cfg, s))
	{
		// Settings
		api.GET("/settings/keys", settingsH.GetKeys)
		api.PUT("/settings/keys", settingsH.UpdateKeys)

		// Projects
		api.GET("/projects", projectH.List)
		api.POST("/projects", projectH.Create)
		api.GET("/projects/:id", projectH.Get)
		api.PATCH("/projects/:id", projectH.Update)
		api.DELETE("/projects/:id", projectH.Delete)

		// Uploads
		api.POST("/projects/:id/uploads", uploadH.Upload)
		api.GET("/projects/:id/uploads", uploadH.List)
		api.DELETE("/projects/:id/uploads/:uid", uploadH.Delete)

		// Harness
		api.POST("/projects/:id/harness", harnessH.Trigger)
		api.GET("/projects/:id/harness/status", harnessH.Status)

		// Dataset
		api.GET("/projects/:id/dataset", datasetH.List)
		api.PATCH("/projects/:id/dataset/:did", datasetH.Update)
		api.DELETE("/projects/:id/dataset/:did", datasetH.Delete)

		// Training
		api.POST("/projects/:id/training", trainingH.Launch)
		api.GET("/projects/:id/training", trainingH.List)
		api.GET("/projects/:id/training/:tid", trainingH.Get)

		// Benchmark
		api.POST("/projects/:id/benchmark", benchmarkH.Trigger)
		api.GET("/projects/:id/benchmark", benchmarkH.List)
	}

	// Worker routes (separate auth — worker token)
	worker := r.Group("/api/worker")
	{
		worker.GET("/poll", workerH.Poll)
		worker.POST("/jobs/:jid/progress", workerH.Progress)
		worker.POST("/jobs/:jid/complete", workerH.Complete)
		worker.POST("/jobs/:jid/fail", workerH.Fail)
	}

	return r
}
