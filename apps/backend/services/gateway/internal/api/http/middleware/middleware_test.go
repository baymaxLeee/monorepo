package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func testHandler(middleware gin.HandlerFunc, next gin.HandlerFunc) http.Handler {
	engine := gin.New()
	engine.Use(middleware)
	engine.NoRoute(next)
	return engine
}
