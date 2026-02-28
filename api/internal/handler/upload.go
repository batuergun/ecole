package handler

import (
	"fmt"
	"net/http"
	"path/filepath"

	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/storage"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type UploadHandler struct {
	store   *store.Store
	storage *storage.Storage
}

func NewUploadHandler(s *store.Store, st *storage.Storage) *UploadHandler {
	return &UploadHandler{store: s, storage: st}
}

func (h *UploadHandler) Upload(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	// Verify project ownership
	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided"})
		return
	}
	defer file.Close()

	ext := filepath.Ext(header.Filename)
	storageKey := fmt.Sprintf("%s/%s%s", projectID, uuid.New().String(), ext)

	if err := h.storage.Save(storageKey, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	upload, err := h.store.CreateUpload(c.Request.Context(), projectID, header.Filename, mimeType, storageKey, header.Size, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record upload"})
		return
	}
	c.JSON(http.StatusCreated, upload)
}

func (h *UploadHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	uploads, err := h.store.ListUploads(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list uploads"})
		return
	}
	if uploads == nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	c.JSON(http.StatusOK, uploads)
}

func (h *UploadHandler) Delete(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if err := h.store.DeleteUpload(c.Request.Context(), c.Param("uid"), projectID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete upload"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
