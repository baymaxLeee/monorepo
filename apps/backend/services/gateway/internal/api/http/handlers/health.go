package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

func Livez(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func Healthz(ready func(context.Context) error) gin.HandlerFunc {
	return func(c *gin.Context) {
		r := c.Request
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		redis := "up"
		if err := ready(ctx); err != nil {
			redis = "down"
		}

		status := "ok"
		code := http.StatusOK
		if redis != "up" {
			status = "degraded"
			code = http.StatusServiceUnavailable
		}
		c.JSON(code, gin.H{
			"status": status,
			"redis":  redis,
		})
	}
}
