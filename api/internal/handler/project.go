package handler

import (
	"encoding/json"
	"net/http"

	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
)

type ProjectHandler struct {
	store *store.Store
}

func NewProjectHandler(s *store.Store) *ProjectHandler {
	return &ProjectHandler{store: s}
}

type createProjectRequest struct {
	Name        string          `json:"name" binding:"required"`
	Description string          `json:"description"`
	Context     json.RawMessage `json:"context"`
}

func (h *ProjectHandler) Create(c *gin.Context) {
	var req createProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID := middleware.GetUserID(c)
	project, err := h.store.CreateProject(c.Request.Context(), userID, req.Name, req.Description, req.Context)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create project"})
		return
	}
	c.JSON(http.StatusCreated, project)
}

func (h *ProjectHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projects, err := h.store.ListProjects(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list projects"})
		return
	}
	if projects == nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	c.JSON(http.StatusOK, projects)
}

func (h *ProjectHandler) Get(c *gin.Context) {
	userID := middleware.GetUserID(c)
	project, err := h.store.GetProject(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}
	c.JSON(http.StatusOK, project)
}

type updateProjectRequest struct {
	Name        string          `json:"name" binding:"required"`
	Description string          `json:"description"`
	Context     json.RawMessage `json:"context"`
}

func (h *ProjectHandler) Update(c *gin.Context) {
	var req updateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID := middleware.GetUserID(c)
	project, err := h.store.UpdateProject(c.Request.Context(), c.Param("id"), userID, req.Name, req.Description, req.Context)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update project"})
		return
	}
	c.JSON(http.StatusOK, project)
}

func (h *ProjectHandler) Delete(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if err := h.store.DeleteProject(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete project"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
