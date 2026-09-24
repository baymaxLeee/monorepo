package canvasarchive

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var (
	ErrUnsafeEntryName   = errors.New("archive entry name is unsafe")
	ErrInputSizeMismatch = errors.New("archive input size does not match snapshot")
)

type OpenFunc func(context.Context) (io.ReadCloser, error)

type Input struct {
	EntryName, SourceAssetID string
	ExpectedSize             int64
	Open                     OpenFunc
}

type Result struct {
	Path, SHA256 string
	Size         int64
}

type Builder struct{ prober MediaProber }

func NewBuilder(prober MediaProber) Builder {
	return Builder{prober: prober}
}

func (builder Builder) Build(ctx context.Context, outputPath string, snapshotAt time.Time, fcpxmlName string, inputs []Input) (result Result, err error) {
	if err = validateInputs(fcpxmlName, inputs); err != nil {
		return Result{}, err
	}
	if builder.prober == nil {
		return Result{}, errors.New("canvas archive media prober is not configured")
	}
	projectName := strings.TrimSuffix(fcpxmlName, ".fcpxml")
	file, err := os.OpenFile(outputPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return Result{}, err
	}
	complete := false
	fileClosed := false
	archiveClosed := false
	hash := sha256.New()
	archive := zip.NewWriter(io.MultiWriter(file, hash))
	defer func() {
		if !archiveClosed {
			err = errors.Join(err, archive.Close())
		}
		if !fileClosed {
			err = errors.Join(err, file.Close())
		}
		if !complete {
			removeErr := os.Remove(outputPath)
			if removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				err = errors.Join(err, removeErr)
			}
		}
	}()
	probed := make([]probedInput, 0, len(inputs))
	for index := range inputs {
		if err = ctx.Err(); err != nil {
			return Result{}, err
		}
		input := inputs[index]
		media, processErr := builder.processInput(ctx, archive, filepath.Dir(outputPath), projectName, snapshotAt, input)
		if processErr != nil {
			return Result{}, processErr
		}
		probed = append(probed, probedInput{Input: input, Media: media})
	}
	fcpxml, err := buildFCPXML(projectName, snapshotAt, probed)
	if err != nil {
		return Result{}, err
	}
	if err = writeStoredEntry(archive, projectName+"/"+fcpxmlName, snapshotAt, strings.NewReader(fcpxml), ctx); err != nil {
		return Result{}, err
	}
	if err = archive.Close(); err != nil {
		archiveClosed = true
		return Result{}, err
	}
	archiveClosed = true
	if err = file.Close(); err != nil {
		fileClosed = true
		return Result{}, err
	}
	fileClosed = true
	info, err := os.Stat(outputPath)
	if err != nil {
		return Result{}, err
	}
	complete = true
	return Result{Path: outputPath, Size: info.Size(), SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}

func (builder Builder) processInput(
	ctx context.Context,
	archive *zip.Writer,
	tempRoot, projectName string,
	snapshotAt time.Time,
	input Input,
) (media MediaInfo, err error) {
	temporary, err := os.CreateTemp(tempRoot, "archive-input-*.mp4")
	if err != nil {
		return MediaInfo{}, err
	}
	temporaryPath := temporary.Name()
	temporaryClosed := false
	defer func() {
		if !temporaryClosed {
			err = errors.Join(err, temporary.Close())
		}
		err = errors.Join(err, removeTemporaryInput(temporaryPath))
	}()
	reader, err := input.Open(ctx)
	if err != nil {
		return MediaInfo{}, err
	}
	written, copyErr := copyWithContext(ctx, temporary, reader)
	closeReaderErr := reader.Close()
	if copyErr != nil || closeReaderErr != nil {
		return MediaInfo{}, errors.Join(copyErr, closeReaderErr)
	}
	if input.ExpectedSize > 0 && written != input.ExpectedSize {
		return MediaInfo{}, ErrInputSizeMismatch
	}
	if err = temporary.Close(); err != nil {
		temporaryClosed = true
		return MediaInfo{}, err
	}
	temporaryClosed = true
	media, err = builder.prober.Probe(ctx, temporaryPath)
	if err != nil {
		return MediaInfo{}, err
	}
	source, err := os.Open(temporaryPath)
	if err != nil {
		return MediaInfo{}, err
	}
	writeErr := writeStoredEntry(archive, projectName+"/"+input.EntryName, snapshotAt, source, ctx)
	closeSourceErr := source.Close()
	if writeErr != nil || closeSourceErr != nil {
		return MediaInfo{}, errors.Join(writeErr, closeSourceErr)
	}
	return media, nil
}

func removeTemporaryInput(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func writeStoredEntry(archive *zip.Writer, name string, modified time.Time, source io.Reader, ctx context.Context) error {
	header := &zip.FileHeader{Name: name, Method: zip.Store, Modified: modified.UTC()}
	destination, err := archive.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = copyWithContext(ctx, destination, source)
	return err
}

func copyWithContext(ctx context.Context, destination io.Writer, source io.Reader) (int64, error) {
	buffer := make([]byte, 32*1024)
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			return written, err
		}
		read, readErr := source.Read(buffer)
		if read > 0 {
			count, writeErr := destination.Write(buffer[:read])
			written += int64(count)
			if writeErr != nil {
				return written, writeErr
			}
			if count != read {
				return written, io.ErrShortWrite
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return written, nil
			}
			return written, readErr
		}
	}
}

func validateInputs(fcpxmlName string, inputs []Input) error {
	seen := make(map[string]struct{}, len(inputs)+1)
	if fcpxmlName == "" || filepath.Base(fcpxmlName) != fcpxmlName || !strings.HasSuffix(fcpxmlName, ".fcpxml") {
		return ErrUnsafeEntryName
	}
	seen[fcpxmlName] = struct{}{}
	for index := range inputs {
		input := inputs[index]
		name := input.EntryName
		if input.Open == nil || name == "" || filepath.Base(name) != name || strings.ContainsAny(name, `/\\`) || filepath.IsAbs(name) {
			return ErrUnsafeEntryName
		}
		if _, exists := seen[name]; exists {
			return ErrUnsafeEntryName
		}
		seen[name] = struct{}{}
	}
	return nil
}
