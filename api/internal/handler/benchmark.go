package handler

import (
	"encoding/json"
	"net/http"

	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/queue"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
)

type BenchmarkHandler struct {
	store *store.Store
	queue *queue.Queue
}

func NewBenchmarkHandler(s *store.Store, q *queue.Queue) *BenchmarkHandler {
	return &BenchmarkHandler{store: s, queue: q}
}

type triggerBenchmarkRequest struct {
	TrainingRunID string `json:"training_run_id" binding:"required"`
}

func (h *BenchmarkHandler) Trigger(c *gin.Context) {
	var req triggerBenchmarkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	payload, _ := json.Marshal(map[string]string{
		"project_id":      projectID,
		"training_run_id": req.TrainingRunID,
	})
	job, err := h.queue.Enqueue(c.Request.Context(), "benchmark", projectID, payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enqueue benchmark"})
		return
	}
	c.JSON(http.StatusCreated, job)
}

func (h *BenchmarkHandler) Delete(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")
	jobID := c.Param("jid")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if err := h.store.DeleteJob(c.Request.Context(), jobID, projectID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete job"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *BenchmarkHandler) JobStatus(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	job, err := h.queue.GetLatestJobByType(c.Request.Context(), projectID, "benchmark")
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no benchmark job found"})
		return
	}
	c.JSON(http.StatusOK, job)
}

func (h *BenchmarkHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	benchmarks, err := h.store.ListBenchmarks(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list benchmarks"})
		return
	}
	if benchmarks == nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	c.JSON(http.StatusOK, benchmarks)
}
