package application

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"os"
	"path"
	"sort"
	"strings"
	"unicode/utf8"
)

const maxArchiveCompressionRatio = 100

var inlineArchiveExtensions = map[string]bool{
	".css": true, ".csv": true, ".html": true, ".ini": true, ".java": true, ".js": true,
	".json": true, ".jsx": true, ".kt": true, ".md": true, ".py": true, ".rb": true,
	".rs": true, ".sh": true, ".sql": true, ".swift": true, ".toml": true, ".ts": true,
	".tsx": true, ".txt": true, ".xml": true, ".yaml": true, ".yml": true,
}

type archiveFile struct {
	Path, MediaType, SHA256 string
	Content                 []byte
	Inline                  bool
}

func extractSkillArchive(raw []byte, maxMemberBytes, maxExpandedBytes int64) ([]archiveFile, error) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, BadRequest("Asset revision is not a valid ZIP archive")
	}
	if len(reader.File) > 500 {
		return nil, BadRequest("skill archive may contain at most 500 entries")
	}
	type entry struct {
		file *zip.File
		path string
	}
	entries := []entry{}
	for _, file := range reader.File {
		normalized := strings.ReplaceAll(file.Name, "\\", "/")
		if file.FileInfo().IsDir() || strings.HasPrefix(normalized, "__MACOSX/") || path.Base(normalized) == ".DS_Store" {
			continue
		}
		clean := path.Clean(normalized)
		if strings.HasPrefix(normalized, "/") || clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || clean != normalized || file.Mode()&os.ModeSymlink != 0 {
			return nil, BadRequest(fmt.Sprintf("unsafe ZIP member path: %s", file.Name))
		}
		if file.Flags&0x1 != 0 {
			return nil, BadRequest(fmt.Sprintf("encrypted ZIP member is not supported: %s", clean))
		}
		entries = append(entries, entry{file: file, path: clean})
	}
	if len(entries) == 0 {
		return nil, BadRequest("skill archive contains no files")
	}
	root := ""
	allNested := true
	for i, value := range entries {
		parts := strings.Split(value.path, "/")
		if len(parts) < 2 {
			allNested = false
			break
		}
		if i == 0 {
			root = parts[0]
		} else if parts[0] != root {
			allNested = false
			break
		}
	}
	seen, total := map[string]bool{}, int64(0)
	result := make([]archiveFile, 0, len(entries))
	for _, entry := range entries {
		name := entry.path
		if allNested {
			name = strings.TrimPrefix(name, root+"/")
		}
		if seen[name] {
			return nil, BadRequest("skill archive contains duplicate paths")
		}
		seen[name] = true
		size, compressed := int64(entry.file.UncompressedSize64), int64(entry.file.CompressedSize64)
		if size > maxMemberBytes {
			return nil, BadRequest(fmt.Sprintf("skill archive member exceeds byte limit: %s", name))
		}
		total += size
		if total > maxExpandedBytes {
			return nil, BadRequest("skill archive exceeds expanded byte limit")
		}
		if size > 0 && compressed == 0 || compressed > 0 && size/compressed > maxArchiveCompressionRatio {
			return nil, BadRequest(fmt.Sprintf("skill archive member exceeds compression ratio limit: %s", name))
		}
		stream, err := entry.file.Open()
		if err != nil {
			return nil, BadRequest(fmt.Sprintf("read ZIP member %s: %v", name, err))
		}
		content, readErr := io.ReadAll(io.LimitReader(stream, maxMemberBytes+1))
		closeErr := stream.Close()
		if readErr != nil || closeErr != nil || int64(len(content)) != size {
			return nil, BadRequest(fmt.Sprintf("skill archive member size mismatch: %s", name))
		}
		digest := sha256.Sum256(content)
		mediaType := mime.TypeByExtension(path.Ext(name))
		if mediaType == "" {
			mediaType = "application/octet-stream"
		} else {
			mediaType = strings.Split(mediaType, ";")[0]
		}
		inline := len(content) <= 200_000 && (strings.HasPrefix(mediaType, "text/") || inlineArchiveExtensions[strings.ToLower(path.Ext(name))]) && utf8.Valid(content)
		result = append(result, archiveFile{Path: name, MediaType: mediaType, SHA256: hex.EncodeToString(digest[:]), Content: content, Inline: inline})
	}
	if !seen["SKILL.md"] && !(allNested && seen["SKILL.md"]) {
		return nil, BadRequest("skill archive must contain a root SKILL.md")
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Path < result[j].Path })
	return result, nil
}
