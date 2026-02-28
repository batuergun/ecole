package handler

import (
	"net/http"

	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	store *store.Store
}

func NewAuthHandler(s *store.Store) *AuthHandler {
	return &AuthHandler{store: s}
}

func (h *AuthHandler) Me(c *gin.Context) {
	userID := middleware.GetUserID(c)
	user, err := h.store.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get user"})
		return
	}
	c.JSON(http.StatusOK, user)
}
