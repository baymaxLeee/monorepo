package canvasarchive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

const maxProbeDiagnosticBytes = 2048

var ErrInvalidMedia = errors.New("archive input media is invalid")

type Rational struct {
	Num int64
	Den int64
}

func newRational(num, den int64) (Rational, error) {
	if num <= 0 || den <= 0 {
		return Rational{}, ErrInvalidMedia
	}
	divisor := greatestCommonDivisor(num, den)
	return Rational{Num: num / divisor, Den: den / divisor}, nil
}

func greatestCommonDivisor(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		return -a
	}
	return a
}

type MediaInfo struct {
	Width, Height            int
	FrameDuration, Duration  Rational
	HasAudio                 bool
	AudioChannels, AudioRate int
}

type MediaProber interface {
	Probe(context.Context, string) (MediaInfo, error)
}

type ProbeCommandRunner interface {
	Run(context.Context, string, ...string) ([]byte, error)
}

type probeCommandRunner struct{}

func (probeCommandRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

type FFprobeProber struct{ runner ProbeCommandRunner }

func NewFFprobeProber(runner ProbeCommandRunner) *FFprobeProber {
	if runner == nil {
		runner = probeCommandRunner{}
	}
	return &FFprobeProber{runner: runner}
}

type probeStream struct {
	CodecType   string          `json:"codec_type"`
	Width       int             `json:"width"`
	Height      int             `json:"height"`
	AverageFPS  string          `json:"avg_frame_rate"`
	ReportedFPS string          `json:"r_frame_rate"`
	TimeBase    string          `json:"time_base"`
	DurationTS  json.RawMessage `json:"duration_ts"`
	SampleRate  string          `json:"sample_rate"`
	Channels    int             `json:"channels"`
}

type probeDocument struct {
	Streams []probeStream `json:"streams"`
	Format  struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

func (prober *FFprobeProber) Probe(ctx context.Context, inputPath string) (MediaInfo, error) {
	output, err := prober.runner.Run(ctx, "ffprobe",
		"-v", "error",
		"-show_entries", "stream=codec_type,width,height,avg_frame_rate,r_frame_rate,time_base,duration_ts,sample_rate,channels:format=duration",
		"-of", "json", inputPath,
	)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return MediaInfo{}, contextErr
		}
		return MediaInfo{}, probeFailure(err, output, inputPath)
	}
	var document probeDocument
	if err = json.Unmarshal(output, &document); err != nil {
		return MediaInfo{}, fmt.Errorf("%w: decode ffprobe output", ErrInvalidMedia)
	}

	var video *probeStream
	info := MediaInfo{}
	for index := range document.Streams {
		stream := &document.Streams[index]
		switch stream.CodecType {
		case "video":
			if video == nil {
				video = stream
			}
		case "audio":
			if !info.HasAudio {
				rate, rateErr := strconv.Atoi(stream.SampleRate)
				if rateErr != nil || rate <= 0 || stream.Channels <= 0 {
					return MediaInfo{}, fmt.Errorf("%w: invalid audio stream", ErrInvalidMedia)
				}
				info.HasAudio = true
				info.AudioChannels = stream.Channels
				info.AudioRate = rate
			}
		}
	}
	if video == nil || video.Width <= 0 || video.Height <= 0 {
		return MediaInfo{}, fmt.Errorf("%w: missing video stream or dimensions", ErrInvalidMedia)
	}

	fps, err := parseRatio(video.AverageFPS)
	if err != nil {
		fps, err = parseRatio(video.ReportedFPS)
	}
	if err != nil {
		return MediaInfo{}, fmt.Errorf("%w: invalid video frame rate", ErrInvalidMedia)
	}
	frameDuration, err := newRational(fps.Den, fps.Num)
	if err != nil {
		return MediaInfo{}, fmt.Errorf("%w: invalid video frame rate", ErrInvalidMedia)
	}
	duration, err := streamDuration(video.DurationTS, video.TimeBase)
	if err != nil {
		duration, err = decimalRational(document.Format.Duration)
	}
	if err != nil {
		return MediaInfo{}, fmt.Errorf("%w: invalid video duration", ErrInvalidMedia)
	}
	info.Width = video.Width
	info.Height = video.Height
	info.FrameDuration = frameDuration
	info.Duration = duration
	return info, nil
}

func parseRatio(value string) (Rational, error) {
	numerator, denominator, found := strings.Cut(strings.TrimSpace(value), "/")
	if !found {
		return Rational{}, ErrInvalidMedia
	}
	num, numErr := strconv.ParseInt(numerator, 10, 64)
	den, denErr := strconv.ParseInt(denominator, 10, 64)
	if numErr != nil || denErr != nil {
		return Rational{}, ErrInvalidMedia
	}
	return newRational(num, den)
}

func streamDuration(raw json.RawMessage, timeBase string) (Rational, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return Rational{}, ErrInvalidMedia
	}
	value := strings.Trim(string(raw), `"`)
	ticks, err := strconv.ParseInt(value, 10, 64)
	if err != nil || ticks <= 0 {
		return Rational{}, ErrInvalidMedia
	}
	base, err := parseRatio(timeBase)
	if err != nil || ticks > (1<<63-1)/base.Num {
		return Rational{}, ErrInvalidMedia
	}
	return newRational(ticks*base.Num, base.Den)
}

func decimalRational(value string) (Rational, error) {
	value = strings.TrimSpace(value)
	whole, fraction, found := strings.Cut(value, ".")
	if !decimalDigits(whole) || (found && !decimalDigits(fraction)) {
		return Rational{}, ErrInvalidMedia
	}
	if !found {
		num, err := strconv.ParseInt(whole, 10, 64)
		if err != nil {
			return Rational{}, ErrInvalidMedia
		}
		return newRational(num, 1)
	}
	if fraction == "" || len(fraction) > 9 {
		return Rational{}, ErrInvalidMedia
	}
	denominator := int64(1)
	for range len(fraction) {
		denominator *= 10
	}
	wholeNumber, wholeErr := strconv.ParseInt(whole, 10, 64)
	fractionNumber, fractionErr := strconv.ParseInt(fraction, 10, 64)
	if wholeErr != nil || fractionErr != nil || wholeNumber < 0 || wholeNumber > (1<<63-1-fractionNumber)/denominator {
		return Rational{}, ErrInvalidMedia
	}
	return newRational(wholeNumber*denominator+fractionNumber, denominator)
}

func decimalDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func probeFailure(err error, output []byte, inputPath string) error {
	diagnostic := strings.TrimSpace(string(output))
	diagnostic = strings.ReplaceAll(diagnostic, inputPath, "[input]")
	if len(diagnostic) > maxProbeDiagnosticBytes {
		diagnostic = diagnostic[:maxProbeDiagnosticBytes] + "...[truncated]"
	}
	if diagnostic == "" {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return fmt.Errorf("%w: ffprobe rejected input: %v", ErrInvalidMedia, err)
		}
		return fmt.Errorf("run ffprobe: %w", err)
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return fmt.Errorf("%w: ffprobe rejected input: %v: diagnostic=%s", ErrInvalidMedia, err, diagnostic)
	}
	return fmt.Errorf("run ffprobe: %w: diagnostic=%s", err, diagnostic)
}
