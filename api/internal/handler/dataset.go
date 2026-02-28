package handler

import (
	"net/http"
	"strconv"

	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
)

type DatasetHandler struct {
	store *store.Store
}

func NewDatasetHandler(s *store.Store) *DatasetHandler {
	return &DatasetHandler{store: s}
}

func (h *DatasetHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	evalOnly := c.Query("eval_only") == "true"

	items, total, err := h.store.ListDatasetItems(c.Request.Context(), projectID, evalOnly, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list dataset"})
		return
	}
	if items == nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "total": total})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total})
}

type updateDatasetItemRequest struct {
	Question string `json:"question" binding:"required"`
	Answer   string `json:"answer" binding:"required"`
}

func (h *DatasetHandler) Update(c *gin.Context) {
	var req updateDatasetItemRequest
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

	item, err := h.store.UpdateDatasetItem(c.Request.Context(), c.Param("did"), projectID, req.Question, req.Answer)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update item"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *DatasetHandler) Delete(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if err := h.store.DeleteDatasetItem(c.Request.Context(), c.Param("did"), projectID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete item"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type batchDeleteRequest struct {
	IDs []string `json:"ids" binding:"required"`
}

func (h *DatasetHandler) BatchDelete(c *gin.Context) {
	var req batchDeleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(req.IDs) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "max 100 items per batch"})
		return
	}

	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	deleted, err := h.store.BatchDeleteDatasetItems(c.Request.Context(), req.IDs, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to batch delete"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": deleted})
}

func (h *DatasetHandler) Stats(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	stats, err := h.store.GetDatasetStats(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get stats"})
		return
	}
	c.JSON(http.StatusOK, stats)
}
