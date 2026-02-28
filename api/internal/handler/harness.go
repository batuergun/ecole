package handler

import (
	"encoding/json"
	"net/http"

	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/queue"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
)

type HarnessHandler struct {
	store *store.Store
	queue *queue.Queue
}

func NewHarnessHandler(s *store.Store, q *queue.Queue) *HarnessHandler {
	return &HarnessHandler{store: s, queue: q}
}

func (h *HarnessHandler) Trigger(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	payload, _ := json.Marshal(map[string]string{"project_id": projectID})
	job, err := h.queue.Enqueue(c.Request.Context(), "harness", projectID, payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enqueue harness job"})
		return
	}

	h.store.UpdateProjectStatus(c.Request.Context(), projectID, "processing")
	c.JSON(http.StatusCreated, job)
}

func (h *HarnessHandler) Status(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	job, err := h.queue.GetLatestJobByType(c.Request.Context(), projectID, "harness")
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no harness job found"})
		return
	}
	c.JSON(http.StatusOK, job)
}
