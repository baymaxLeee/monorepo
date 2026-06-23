package schema

import "time"

type ObjectResponse struct {
	Bucket             string            `json:"bucket"`
	Key                string            `json:"key"`
	ETag               string            `json:"etag"`
	SHA256             string            `json:"sha256"`
	Size               int64             `json:"size"`
	ContentType        string            `json:"content_type"`
	ContentDisposition string            `json:"content_disposition,omitempty"`
	Metadata           map[string]string `json:"metadata"`
	OwnerUserID        string            `json:"owner_user_id,omitempty"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

type Problem struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
