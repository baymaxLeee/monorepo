package officialresource

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DefaultAssetsDir 是官方预置素材文件在运行时的默认目录（相对服务工作目录）。
//
// 官方预置素材（音色、形象、场景、道具等）都是单素材：一条清单条目对应一个官方 Resource +
// 一个插槽 + 一份内容。素材文件作为普通文件随仓库提交并打进镜像（见
// build/docker/agentframe-app.Dockerfile 的 COPY），运行时按 slug 读取后走上传链路，而不是编入
// 二进制：静态素材不必进可执行文件，也便于单独替换。
const DefaultAssetsDir = "runtime/preset-assets"

// DirAssets 从目录按 slug 读官方预置素材文件，实现 AssetBytesSource。素材类型无关：音频、
// 图片等都按 {slug}{ext} 定位，扩展名由清单条目声明。
//
// 文件名以 slug 命名而非展示名：展示名（如 "邻家女孩 2.0.mp3"）含空格与非 ASCII，不适合直接
// 做文件系统键；slug 是稳定的纯标识，与展示名解耦。发送给模型的原始文件名仍由清单的
// FileName 决定。
type DirAssets struct {
	dir string
}

// NewDirAssets 用给定目录构造字节源；空目录回退到 DefaultAssetsDir。
func NewDirAssets(dir string) DirAssets {
	if strings.TrimSpace(dir) == "" {
		dir = DefaultAssetsDir
	}
	return DirAssets{dir: dir}
}

// AssetBytes 按 slug + 扩展名返回素材字节。
//
// slug 校验为纯 [A-Za-z0-9_]，杜绝路径穿越；找不到文件时返回错误而不是空字节，避免上传一个
// 空 Blob——清单声明了条目却缺文件是部署期就该暴露的不一致。
func (d DirAssets) AssetBytes(slug, ext string) ([]byte, error) {
	if !validAssetSlug(slug) {
		return nil, fmt.Errorf("invalid preset asset slug %q", slug)
	}
	path := filepath.Join(d.dir, slug+ext)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read preset asset %q: %w", slug, err)
	}
	return data, nil
}

func validAssetSlug(slug string) bool {
	if slug == "" {
		return false
	}
	for _, char := range slug {
		switch {
		case char >= '0' && char <= '9':
		case char >= 'a' && char <= 'z':
		case char >= 'A' && char <= 'Z':
		case char == '_':
		default:
			return false
		}
	}
	return true
}
