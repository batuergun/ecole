package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/batuhanergun/ecole/api/internal/config"
	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type AuthHandler struct {
	store *store.Store
	cfg   *config.Config
}

func NewAuthHandler(s *store.Store, cfg *config.Config) *AuthHandler {
	return &AuthHandler{store: s, cfg: cfg}
}

// Login redirects to WorkOS AuthKit authorization URL.
func (h *AuthHandler) Login(c *gin.Context) {
	if h.cfg.IsDevMode() {
		c.JSON(http.StatusOK, gin.H{"dev_mode": true})
		return
	}

	authURL := fmt.Sprintf(
		"https://api.workos.com/user_management/authorize?"+
			"client_id=%s&"+
			"redirect_uri=%s&"+
			"response_type=code&"+
			"provider=authkit",
		url.QueryEscape(h.cfg.WorkOSClientID),
		url.QueryEscape(h.cfg.WorkOSRedirectURI),
	)
	c.JSON(http.StatusOK, gin.H{"url": authURL})
}

// Callback exchanges the WorkOS authorization code for user info.
func (h *AuthHandler) Callback(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing code parameter"})
		return
	}

	if h.cfg.IsDevMode() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "auth callback not available in dev mode"})
		return
	}

	// Exchange code for user info via WorkOS API
	userInfo, err := h.exchangeCode(code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to authenticate: " + err.Error()})
		return
	}

	// Upsert user in database
	user, err := h.store.UpsertUser(
		c.Request.Context(),
		userInfo.ID,
		userInfo.Email,
		userInfo.Name,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
		return
	}

	// Create JWT session token
	token, err := h.createSessionToken(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create session"})
		return
	}

	// Set httpOnly cookie
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("ecole_session", token, 7*24*3600, "/", "", false, true)

	// Redirect to frontend
	c.Redirect(http.StatusTemporaryRedirect, "/")
}

// Logout clears the session cookie.
func (h *AuthHandler) Logout(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("ecole_session", "", -1, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Me returns the current authenticated user.
func (h *AuthHandler) Me(c *gin.Context) {
	userID := middleware.GetUserID(c)
	user, err := h.store.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get user"})
		return
	}
	c.JSON(http.StatusOK, user)
}

// --- Internal helpers ---

type workosUser struct {
	ID    string
	Email string
	Name  string
}

func (h *AuthHandler) exchangeCode(code string) (*workosUser, error) {
	// Call WorkOS User Management API to authenticate with code
	data := url.Values{
		"client_id":     {h.cfg.WorkOSClientID},
		"client_secret": {h.cfg.WorkOSAPIKey},
		"grant_type":    {"authorization_code"},
		"code":          {code},
	}

	resp, err := http.PostForm("https://api.workos.com/user_management/authenticate", data)
	if err != nil {
		return nil, fmt.Errorf("workos request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("workos returned status %d", resp.StatusCode)
	}

	var result struct {
		User struct {
			ID        string `json:"id"`
			Email     string `json:"email"`
			FirstName string `json:"first_name"`
			LastName  string `json:"last_name"`
		} `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode workos response: %w", err)
	}

	name := result.User.FirstName
	if result.User.LastName != "" {
		name += " " + result.User.LastName
	}
	if name == "" {
		name = result.User.Email
	}

	return &workosUser{
		ID:    result.User.ID,
		Email: result.User.Email,
		Name:  name,
	}, nil
}

func (h *AuthHandler) createSessionToken(userID string) (string, error) {
	claims := jwt.MapClaims{
		"sub": userID,
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(7 * 24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(h.cfg.JWTSecret))
}
