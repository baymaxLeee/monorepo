package modelcatalog

import "testing"

func TestProviderCapabilitiesComeFromConfiguredUpstreamModel(t *testing.T) {
	video := videoCapabilities("doubao-seedance-2-5-pro-250922")
	if video.DurationMinSeconds != 4 || video.DurationMaxSeconds != 30 {
		t.Fatalf("unexpected Seedance 2.5 duration range: %d..%d", video.DurationMinSeconds, video.DurationMaxSeconds)
	}
	if video.MaxImageReferences == nil || *video.MaxImageReferences != 9 ||
		video.MaxVideoReferences == nil || *video.MaxVideoReferences != 3 ||
		video.MaxAudioReferences == nil || *video.MaxAudioReferences != 3 {
		t.Fatalf("unexpected Seedance 2.5 reference limits: %#v", video)
	}

	image := imageCapabilities("doubao-seedream-4-0-250828")
	if image.MaxInputReferences == nil || *image.MaxInputReferences != 10 {
		t.Fatalf("unexpected Seedream reference limit: %#v", image.MaxInputReferences)
	}
}

func TestUnknownModelsUseConservativeCapabilities(t *testing.T) {
	video := videoCapabilities("custom-video-model")
	if video.DurationMinSeconds != 5 || video.DurationMaxSeconds != 10 {
		t.Fatalf("unexpected fallback duration range: %d..%d", video.DurationMinSeconds, video.DurationMaxSeconds)
	}
	if video.MaxImageReferences == nil || *video.MaxImageReferences != 0 {
		t.Fatalf("unknown video model must not advertise image references: %#v", video.MaxImageReferences)
	}
	image := imageCapabilities("custom-image-model")
	if image.MaxInputReferences == nil || *image.MaxInputReferences != 0 {
		t.Fatalf("unknown image model must not advertise image references: %#v", image.MaxInputReferences)
	}
}
