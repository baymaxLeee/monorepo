package firstlastframe

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

const maxCommandDiagnosticBytes = 2048

type CommandRunner interface {
	Run(context.Context, string, ...string) ([]byte, error)
}

type commandRunner struct{}

func (commandRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

type FFmpegExtractor struct{ runner CommandRunner }

func NewFFmpegExtractor(runner CommandRunner) *FFmpegExtractor {
	if runner == nil {
		runner = commandRunner{}
	}
	return &FFmpegExtractor{runner: runner}
}

func (extractor *FFmpegExtractor) Extract(ctx context.Context, inputPath, firstPath, lastPath string) error {
	if err := extractor.extractFrame(ctx, inputPath, firstPath, 0); err != nil {
		return fmt.Errorf("extract first video frame: %w", err)
	}
	// image2's update mode overwrites one JPEG for every decoded frame, so
	// seeking near EOF leaves the final decodable frame without a full-file
	// frame count pass. Keep exact counting only as a malformed-timestamp or
	// unsupported-seek fallback.
	tailErr := extractor.extractTailFrame(ctx, inputPath, lastPath)
	if tailErr == nil {
		return nil
	}
	if fallbackErr := extractor.extractExactLastFrame(ctx, inputPath, firstPath, lastPath); fallbackErr != nil {
		return errors.Join(
			fmt.Errorf("extract last video frame from tail: %w", tailErr),
			fmt.Errorf("extract exact last video frame fallback: %w", fallbackErr),
		)
	}
	return nil
}

func (extractor *FFmpegExtractor) extractExactLastFrame(ctx context.Context, inputPath, firstPath, lastPath string) error {
	output, err := extractor.runner.Run(ctx, "ffprobe",
		"-v", "error", "-select_streams", "v:0", "-count_frames",
		"-show_entries", "stream=nb_read_frames", "-of", "default=nokey=1:noprint_wrappers=1", inputPath,
	)
	if err != nil {
		return commandFailure("probe video frame count", err, output)
	}
	frameCount, err := strconv.ParseInt(strings.TrimSpace(string(output)), 10, 64)
	if err != nil || frameCount < 1 {
		return errors.New("video has no readable frames")
	}
	if frameCount == 1 {
		return copyFile(firstPath, lastPath)
	}
	if err = extractor.extractFrame(ctx, inputPath, lastPath, frameCount-1); err != nil {
		return fmt.Errorf("extract last video frame: %w", err)
	}
	return nil
}

func (extractor *FFmpegExtractor) extractTailFrame(ctx context.Context, inputPath, outputPath string) error {
	if err := removeOutput(outputPath); err != nil {
		return err
	}
	output, err := extractor.runner.Run(ctx, "ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y", "-sseof", "-2", "-i", inputPath,
		"-map", "0:v:0", "-an", "-sn", "-fps_mode", "passthrough", "-q:v", "2", "-update", "1", outputPath,
	)
	if err != nil {
		return commandFailure("ffmpeg tail seek command failed", err, output)
	}
	info, err := os.Stat(outputPath)
	if err != nil || info.Size() == 0 {
		return errors.New("ffmpeg tail seek produced no JPEG")
	}
	return nil
}

func (extractor *FFmpegExtractor) extractFrame(ctx context.Context, inputPath, outputPath string, frameIndex int64) error {
	if err := removeOutput(outputPath); err != nil {
		return err
	}
	output, err := extractor.runner.Run(ctx, "ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameIndex), "-frames:v", "1", "-q:v", "2", outputPath,
	)
	if err != nil {
		return commandFailure("ffmpeg command failed", err, output)
	}
	info, err := os.Stat(outputPath)
	if err != nil || info.Size() == 0 {
		return errors.New("ffmpeg produced no JPEG")
	}
	return nil
}

func removeOutput(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		var pathErr *os.PathError
		if errors.As(err, &pathErr) {
			return fmt.Errorf("remove stale frame output: %w", pathErr.Err)
		}
		return errors.New("remove stale frame output")
	}
	return nil
}

func commandFailure(operation string, err error, output []byte) error {
	diagnostic := strings.TrimSpace(string(output))
	if len(diagnostic) > maxCommandDiagnosticBytes {
		diagnostic = diagnostic[:maxCommandDiagnosticBytes] + "...[truncated]"
	}
	if diagnostic == "" {
		return fmt.Errorf("%s: %w", operation, err)
	}
	return fmt.Errorf("%s: %w: diagnostic=%s", operation, err, diagnostic)
}

func copyFile(source, target string) error {
	content, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return os.WriteFile(target, content, 0o600)
}
