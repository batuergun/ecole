package handler

import (
	"encoding/json"
	"net/http"

	"github.com/batuhanergun/ecole/api/internal/queue"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

type WorkerHandler struct {
	store *store.Store
	queue *queue.Queue
}

func NewWorkerHandler(s *store.Store, q *queue.Queue) *WorkerHandler {
	return &WorkerHandler{store: s, queue: q}
}

func (h *WorkerHandler) Poll(c *gin.Context) {
	workerID := c.Query("worker_id")
	if workerID == "" {
		workerID = "anonymous"
	}

	job, err := h.queue.Claim(c.Request.Context(), workerID)
	if err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNoContent, nil)
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to poll"})
		return
	}
	c.JSON(http.StatusOK, job)
}

type progressRequest struct {
	Status string          `json:"status"`
	Data   json.RawMessage `json:"data"`
}

func (h *WorkerHandler) Progress(c *gin.Context) {
	var req progressRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	jobID := c.Param("jid")
	if err := h.queue.UpdateProgress(c.Request.Context(), jobID, req.Status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update progress"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *WorkerHandler) Complete(c *gin.Context) {
	jobID := c.Param("jid")
	if err := h.queue.Complete(c.Request.Context(), jobID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to complete job"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type failRequest struct {
	Error string `json:"error" binding:"required"`
}

func (h *WorkerHandler) Fail(c *gin.Context) {
	var req failRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	jobID := c.Param("jid")
	if err := h.queue.Fail(c.Request.Context(), jobID, req.Error); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fail job"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
