package middleware

import (
	"net/http"
	"strings"

	"github.com/batuhanergun/ecole/api/internal/config"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const UserIDKey = "user_id"

func Auth(cfg *config.Config, s *store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.IsDevMode() {
			// Dev bypass: upsert a dev user and set their ID
			user, err := s.UpsertUser(c.Request.Context(), "dev-user", "dev@ecole.local", "Dev User")
			if err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "failed to create dev user"})
				return
			}
			c.Set(UserIDKey, user.ID)
			c.Next()
			return
		}

		// Production: verify JWT from cookie or Authorization header
		tokenStr := ""

		// Try cookie first
		if cookie, err := c.Cookie("ecole_session"); err == nil && cookie != "" {
			tokenStr = cookie
		}

		// Fall back to Authorization header
		if tokenStr == "" {
			authHeader := c.GetHeader("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}

		if tokenStr == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		// Verify JWT
		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired session"})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token claims"})
			return
		}

		userID, ok := claims["sub"].(string)
		if !ok || userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token subject"})
			return
		}

		c.Set(UserIDKey, userID)
		c.Next()
	}
}

func GetUserID(c *gin.Context) string {
	return c.GetString(UserIDKey)
}
