package handler

import (
	"net/http"

	"github.com/batuhanergun/ecole/api/internal/config"
	"github.com/batuhanergun/ecole/api/internal/crypto"
	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
)

type SettingsHandler struct {
	store *store.Store
	cfg   *config.Config
}

func NewSettingsHandler(s *store.Store, cfg *config.Config) *SettingsHandler {
	return &SettingsHandler{store: s, cfg: cfg}
}

func (h *SettingsHandler) GetKeys(c *gin.Context) {
	userID := middleware.GetUserID(c)

	anthropicEnc, _ := h.store.GetAnthropicKey(c.Request.Context(), userID)
	hfEnc, _ := h.store.GetHFToken(c.Request.Context(), userID)

	anthropicMasked := ""
	if len(anthropicEnc) > 0 {
		if dec, err := crypto.Decrypt(anthropicEnc, h.cfg.EncryptionKey); err == nil && len(dec) > 4 {
			anthropicMasked = "****" + string(dec[len(dec)-4:])
		}
	}

	hfMasked := ""
	if len(hfEnc) > 0 {
		if dec, err := crypto.Decrypt(hfEnc, h.cfg.EncryptionKey); err == nil && len(dec) > 4 {
			hfMasked = "****" + string(dec[len(dec)-4:])
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"anthropic_key": anthropicMasked,
		"hf_token":      hfMasked,
	})
}

type updateKeysRequest struct {
	AnthropicKey string `json:"anthropic_key"`
	HFToken      string `json:"hf_token"`
}

func (h *SettingsHandler) UpdateKeys(c *gin.Context) {
	var req updateKeysRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := middleware.GetUserID(c)

	if req.AnthropicKey != "" {
		enc, err := crypto.Encrypt([]byte(req.AnthropicKey), h.cfg.EncryptionKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt key"})
			return
		}
		if err := h.store.SetAnthropicKey(c.Request.Context(), userID, enc); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save key"})
			return
		}
	}

	if req.HFToken != "" {
		enc, err := crypto.Encrypt([]byte(req.HFToken), h.cfg.EncryptionKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt token"})
			return
		}
		if err := h.store.SetHFToken(c.Request.Context(), userID, enc); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save token"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
