package bootstrap

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Environment           string
	Port                  string
	DatabaseURL           string
	DataDir               string
	InternalServiceTokens map[string]string
	MaxUploadBytes        int64
	MinFreeBytes          int64
	GCInterval            time.Duration
	CandidateAge          time.Duration
	Retention             time.Duration
	SigningKey            string
	DeliveryURLTTL        time.Duration
}

func Load() (Config, error) {
	_ = godotenv.Load()
	environment := envOr("ENVIRONMENT", "development")
	if environment != "development" && environment != "staging" && environment != "single-vps" && environment != "production" {
		return Config{}, fmt.Errorf("unsupported ENVIRONMENT %q", environment)
	}
	deployed := environment != "development"
	password, err := requiredEnv("POSTGRES_PASSWORD", deployed, "asset")
	if err != nil {
		return Config{}, err
	}
	dataDir, err := requiredEnv("ASSET_DATA_DIR", deployed, "./data")
	if err != nil {
		return Config{}, err
	}
	if deployed && (password == "asset" || !strings.HasPrefix(dataDir, "/")) {
		return Config{}, fmt.Errorf("deployed environments require non-development database credentials and an absolute ASSET_DATA_DIR")
	}
	tokens, err := serviceTokens(environment)
	if err != nil {
		return Config{}, err
	}
	maxUpload, err := positiveBytes("ASSET_MAX_UPLOAD_BYTES", 5<<30)
	if err != nil {
		return Config{}, err
	}
	minFree, err := positiveBytes("ASSET_MIN_FREE_BYTES", 1<<30)
	if err != nil {
		return Config{}, err
	}
	gcInterval, err := positiveDuration("ASSET_GC_INTERVAL", time.Hour)
	if err != nil {
		return Config{}, err
	}
	candidateAge, err := positiveDuration("ASSET_CANDIDATE_AGE", 24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	retention, err := positiveDuration("ASSET_RETENTION", 7*24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	signingKey, err := requiredEnv("ASSET_SIGNING_KEY", deployed, "dev-asset-delivery-signing-key")
	if err != nil {
		return Config{}, err
	}
	if deployed && len(signingKey) < 32 {
		return Config{}, fmt.Errorf("ASSET_SIGNING_KEY must be at least 32 bytes outside development")
	}
	deliveryURLTTL, err := positiveDuration("ASSET_DELIVERY_URL_TTL", 15*time.Minute)
	if err != nil {
		return Config{}, err
	}
	host := envOr("POSTGRES_HOST", "localhost")
	port := envOr("POSTGRES_PORT", "5432")
	user := envOr("POSTGRES_USER", "asset")
	database := envOr("POSTGRES_DATABASE", "asset")
	sslMode := envOr("POSTGRES_SSLMODE", "disable")
	return Config{
		Environment: environment, Port: envOr("PORT", "8013"), DataDir: dataDir,
		DatabaseURL:           fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", host, port, user, password, database, sslMode),
		InternalServiceTokens: tokens, MaxUploadBytes: maxUpload, MinFreeBytes: minFree,
		GCInterval: gcInterval, CandidateAge: candidateAge, Retention: retention,
		SigningKey: signingKey, DeliveryURLTTL: deliveryURLTTL,
	}, nil
}

func serviceTokens(environment string) (map[string]string, error) {
	raw := envOr("INTERNAL_SERVICE_TOKENS", `{"admin":"dev-admin-internal-token","canvas":"dev-canvas-internal-token","chat":"dev-chat-internal-token","executor":"dev-executor-internal-token","knowledge":"dev-knowledge-internal-token"}`)
	var tokens map[string]string
	if err := json.Unmarshal([]byte(raw), &tokens); err != nil {
		return nil, fmt.Errorf("INTERNAL_SERVICE_TOKENS must be a JSON object: %w", err)
	}
	required := []string{"admin", "canvas", "chat", "executor", "knowledge"}
	if len(tokens) != len(required) {
		return nil, fmt.Errorf("INTERNAL_SERVICE_TOKENS must define exactly %s", strings.Join(required, ", "))
	}
	seen := map[string]struct{}{}
	for _, caller := range required {
		token := tokens[caller]
		if token == "" || (environment != "development" && (len(token) < 32 || strings.HasPrefix(token, "dev-"))) {
			return nil, fmt.Errorf("invalid internal credential for %s", caller)
		}
		seen[token] = struct{}{}
	}
	if len(seen) != len(required) {
		return nil, fmt.Errorf("internal service credentials must be unique")
	}
	return tokens, nil
}

func requiredEnv(key string, deployed bool, fallback string) (string, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value != "" {
		return value, nil
	}
	if deployed {
		return "", fmt.Errorf("%s is required outside development", key)
	}
	return fallback, nil
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func positiveBytes(key string, fallback int64) (int64, error) {
	raw := envOr(key, strconv.FormatInt(fallback, 10))
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return value, nil
}

func positiveDuration(key string, fallback time.Duration) (time.Duration, error) {
	value, err := time.ParseDuration(envOr(key, fallback.String()))
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive duration", key)
	}
	return value, nil
}
