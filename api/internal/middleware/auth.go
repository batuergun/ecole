package middleware

import (
	"net/http"

	"github.com/batuhanergun/ecole/api/internal/config"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
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

		// TODO: WorkOS JWT verification
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
	}
}

func GetUserID(c *gin.Context) string {
	return c.GetString(UserIDKey)
}
