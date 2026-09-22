package officialasset

import (
	"errors"
	"strings"
	"time"
)

var (
	ErrInvalidSharedBlob         = errors.New("invalid official shared blob")
	ErrSharedBlobLeaseConflict   = errors.New("official shared blob lease conflict")
	ErrSharedBlobVersionConflict = errors.New("official shared blob version conflict")
)

type SharedBlobStatus int16

const (
	SharedBlobPending SharedBlobStatus = iota + 1
	SharedBlobUploading
	SharedBlobAvailable
	SharedBlobFailed
)

func (s SharedBlobStatus) Valid() bool {
	return s >= SharedBlobPending && s <= SharedBlobFailed
}

// SharedBlob records one immutable manifest content version. BlobID is global;
// tenant scope is introduced only when the Blob is registered as an Artifact.
type SharedBlob struct {
	Slug           string
	FileSHA256     string
	BlobID         string
	Status         SharedBlobStatus
	LeaseOwner     string
	LeaseExpiresAt *time.Time
	FileName       string
	ContentType    string
	SizeBytes      int64
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func NewSharedBlob(slug, fileSHA256, fileName, contentType string, now time.Time) (SharedBlob, error) {
	slug = strings.TrimSpace(slug)
	fileSHA256 = strings.ToLower(strings.TrimSpace(fileSHA256))
	fileName = strings.TrimSpace(fileName)
	contentType = strings.TrimSpace(contentType)
	if slug == "" || !validSHA256Hex(fileSHA256) || fileName == "" || contentType == "" || now.IsZero() {
		return SharedBlob{}, ErrInvalidSharedBlob
	}
	now = now.UTC()
	return SharedBlob{
		Slug: slug, FileSHA256: fileSHA256, FileName: fileName, ContentType: contentType,
		Status: SharedBlobPending, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (b SharedBlob) Available() bool {
	return b.Status == SharedBlobAvailable && b.BlobID != "" && b.SizeBytes > 0
}

func (b SharedBlob) Claim(owner string, now, expires time.Time) (SharedBlob, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" || now.IsZero() || !expires.After(now) {
		return SharedBlob{}, ErrInvalidSharedBlob
	}
	if b.Status == SharedBlobAvailable ||
		(b.Status == SharedBlobUploading && b.LeaseExpiresAt != nil && b.LeaseExpiresAt.After(now)) {
		return SharedBlob{}, ErrSharedBlobLeaseConflict
	}
	now = now.UTC()
	expires = expires.UTC()
	b.Status = SharedBlobUploading
	b.BlobID = ""
	b.SizeBytes = 0
	b.LeaseOwner = owner
	b.LeaseExpiresAt = &expires
	b.UpdatedAt = now
	return b, nil
}

func (b SharedBlob) Complete(owner, blobID string, sizeBytes int64, now time.Time) (SharedBlob, error) {
	owner = strings.TrimSpace(owner)
	blobID = strings.TrimSpace(blobID)
	if b.Status != SharedBlobUploading || b.LeaseOwner != owner {
		return SharedBlob{}, ErrSharedBlobLeaseConflict
	}
	if owner == "" || blobID == "" || sizeBytes <= 0 || now.IsZero() {
		return SharedBlob{}, ErrInvalidSharedBlob
	}
	b.Status = SharedBlobAvailable
	b.BlobID = blobID
	b.SizeBytes = sizeBytes
	b.LeaseOwner = ""
	b.LeaseExpiresAt = nil
	b.UpdatedAt = now.UTC()
	return b, nil
}

func (b SharedBlob) Fail(owner string, now time.Time) (SharedBlob, error) {
	owner = strings.TrimSpace(owner)
	if b.Status != SharedBlobUploading || b.LeaseOwner != owner {
		return SharedBlob{}, ErrSharedBlobLeaseConflict
	}
	if owner == "" || now.IsZero() {
		return SharedBlob{}, ErrInvalidSharedBlob
	}
	b.Status = SharedBlobFailed
	b.BlobID = ""
	b.SizeBytes = 0
	b.LeaseOwner = ""
	b.LeaseExpiresAt = nil
	b.UpdatedAt = now.UTC()
	return b, nil
}

func (b SharedBlob) Invalidate(blobID string, now time.Time) (SharedBlob, error) {
	blobID = strings.TrimSpace(blobID)
	if !b.Available() || b.BlobID != blobID {
		return SharedBlob{}, ErrSharedBlobVersionConflict
	}
	if blobID == "" || now.IsZero() {
		return SharedBlob{}, ErrInvalidSharedBlob
	}
	b.Status = SharedBlobFailed
	b.BlobID = ""
	b.SizeBytes = 0
	b.UpdatedAt = now.UTC()
	return b, nil
}
