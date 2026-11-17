package application

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"io"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const (
	MaxImageBytes  = 32 * 1024 * 1024
	maxImagePixels = 40_000_000
)

func ImageVariant(source io.ReadSeeker, size int64, maxDimension int) ([]byte, error) {
	if maxDimension < 1 || maxDimension > 4096 || size > MaxImageBytes {
		return nil, fmt.Errorf("image exceeds variant bounds")
	}
	config, _, err := image.DecodeConfig(io.LimitReader(source, MaxImageBytes))
	if err != nil {
		return nil, err
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxImagePixels {
		return nil, fmt.Errorf("image pixel count exceeds variant bounds")
	}
	if _, err = source.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	decoded, err := imaging.Decode(io.LimitReader(source, MaxImageBytes), imaging.AutoOrientation(true))
	if err != nil {
		return nil, err
	}
	resized := imaging.Fit(decoded, maxDimension, maxDimension, imaging.Lanczos)
	flattened := image.NewRGBA(resized.Bounds())
	draw.Draw(flattened, flattened.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(flattened, flattened.Bounds(), resized, resized.Bounds().Min, draw.Over)
	var output bytes.Buffer
	if err = jpeg.Encode(&output, flattened, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
