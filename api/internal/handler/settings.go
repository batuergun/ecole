package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type SettingsHandler struct{}

func NewSettingsHandler() *SettingsHandler {
	return &SettingsHandler{}
}

func (h *SettingsHandler) GetKeys(c *gin.Context) {
	// TODO: fetch encrypted keys, return masked
	c.JSON(http.StatusOK, gin.H{
		"anthropic_key": "",
		"hf_token":      "",
	})
}

func (h *SettingsHandler) UpdateKeys(c *gin.Context) {
	// TODO: encrypt and store keys
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
