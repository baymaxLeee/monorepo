package httpapi

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestImageVariantPreservesOriginalAndFlattensTransparency(t *testing.T) {
	var original bytes.Buffer
	if err := png.Encode(&original, image.NewNRGBA(image.Rect(0, 0, 40, 20))); err != nil {
		t.Fatal(err)
	}
	input := append([]byte(nil), original.Bytes()...)
	result, err := imageVariant(bytes.NewReader(input), int64(len(input)), 10)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := jpeg.Decode(bytes.NewReader(result))
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds().Dx() != 10 || decoded.Bounds().Dy() != 5 {
		t.Fatalf("unexpected dimensions: %v", decoded.Bounds())
	}
	r, g, b, _ := decoded.At(0, 0).RGBA()
	if r < 65000 || g < 65000 || b < 65000 {
		t.Fatal("transparent image must become white, not black")
	}
	if !bytes.Equal(input, original.Bytes()) {
		t.Fatal("original was mutated")
	}
	for _, size := range []int{0, 4097} {
		if _, err = imageVariant(bytes.NewReader(input), int64(len(input)), size); err == nil {
			t.Fatal("accepted invalid dimensions")
		}
	}
	if _, err = imageVariant(bytes.NewReader(input), maxImageBytes+1, 10); err == nil {
		t.Fatal("accepted oversized source")
	}
	if _, err = imageVariant(bytes.NewReader([]byte("not an image")), 12, 10); err == nil {
		t.Fatal("accepted non-image")
	}
}

func TestVariantSignatureCannotBeUsedForOriginalOrDifferentSize(t *testing.T) {
	router := &Router{signingKey: []byte("secret")}
	original := router.signDeliveryVariant("t", "w", "a", "r", 1234, 0)
	thumbnail := router.signDeliveryVariant("t", "w", "a", "r", 1234, 512)
	if original == thumbnail || thumbnail == router.signDeliveryVariant("t", "w", "a", "r", 1234, 1024) {
		t.Fatal("transformation parameters must be signed")
	}
}
