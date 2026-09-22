package canvasarchive

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
)

const maxFCPXMLTimeDenominator = int64(1<<31 - 1)

type probedInput struct {
	Input Input
	Media MediaInfo
}

type mediaFormat struct {
	ID            string
	Width, Height int
	FrameDuration Rational
}

func buildFCPXML(projectName string, snapshotAt time.Time, inputs []probedInput) (string, error) {
	if len(inputs) == 0 {
		return "", ErrInvalidMedia
	}
	formats := make([]mediaFormat, 0, len(inputs))
	formatIDs := make([]string, len(inputs))
	formatIndex := make(map[string]string, len(inputs))
	for index, input := range inputs {
		if err := validateMediaInfo(input.Media); err != nil {
			return "", err
		}
		key := fmt.Sprintf("%dx%d:%d/%d", input.Media.Width, input.Media.Height, input.Media.FrameDuration.Num, input.Media.FrameDuration.Den)
		formatID, exists := formatIndex[key]
		if !exists {
			formatID = fmt.Sprintf("r%d", len(formats)+1)
			formatIndex[key] = formatID
			formats = append(formats, mediaFormat{
				ID: formatID, Width: input.Media.Width, Height: input.Media.Height, FrameDuration: input.Media.FrameDuration,
			})
		}
		formatIDs[index] = formatID
	}

	sequenceDuration, err := sumDurations(inputs)
	if err != nil {
		return "", err
	}
	assetStart := len(formats) + 1
	var body strings.Builder
	body.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	body.WriteString(`<fcpxml version="1.13">` + "\n  <resources>\n")
	for _, format := range formats {
		_, _ = fmt.Fprintf(&body,
			`    <format id="%s" frameDuration="%s" width="%d" height="%d" colorSpace="1-1-1 (Rec. 709)"></format>`+"\n",
			format.ID, fcpxmlTime(format.FrameDuration), format.Width, format.Height,
		)
	}
	for index, input := range inputs {
		assetID := fmt.Sprintf("r%d", assetStart+index)
		uid := stableUID("asset:" + input.Input.ArtifactID + ":" + input.Input.EntryName)
		_, _ = fmt.Fprintf(&body,
			`    <asset id="%s" name="%s" uid="%s" start="0s" hasVideo="1" videoSources="1" format="%s" duration="%s"`,
			assetID, xmlEscape(input.Input.EntryName), uid, formatIDs[index], fcpxmlTime(input.Media.Duration),
		)
		if input.Media.HasAudio {
			_, _ = fmt.Fprintf(&body, ` hasAudio="1" audioSources="1" audioChannels="%d" audioRate="%d"`, input.Media.AudioChannels, input.Media.AudioRate)
		}
		mediaSource := "file://__PLACEHOLDER__/" + input.Input.EntryName
		_, _ = fmt.Fprintf(&body,
			`><media-rep kind="original-media" sig="%s" src="%s"></media-rep></asset>`+"\n",
			uid, xmlEscape(mediaSource),
		)
	}
	body.WriteString("  </resources>\n  <library location=\"file:///Users/Shared/Untitled.fcpbundle/\">\n")
	_, _ = fmt.Fprintf(&body, `    <event name="export" uid="%s">`+"\n", stableUID("event:"+projectName))
	_, _ = fmt.Fprintf(&body, `      <project name="%s" uid="%s" modDate="%s">`+"\n",
		xmlEscape(projectName), stableUID("project:"+projectName), snapshotAt.UTC().Format("2006-01-02 15:04:05.000 -0700"))
	_, _ = fmt.Fprintf(&body, `        <sequence format="%s" duration="%s" tcStart="0s" tcFormat="NDF"`, formatIDs[0], fcpxmlTime(sequenceDuration))
	if layout, rate := sequenceAudio(inputs); layout != "" {
		_, _ = fmt.Fprintf(&body, ` audioLayout="%s" audioRate="%s"`, layout, rate)
	}
	body.WriteString(">\n          <spine>\n")
	_, _ = fmt.Fprintf(&body, `            <gap offset="0s" name="Master" duration="%s">`+"\n", fcpxmlTime(sequenceDuration))
	offset := Rational{Num: 0, Den: 1}
	for index, input := range inputs {
		assetID := fmt.Sprintf("r%d", assetStart+index)
		_, _ = fmt.Fprintf(&body,
			`              <asset-clip ref="%s" offset="%s" name="%s" duration="%s" lane="1"></asset-clip>`+"\n",
			assetID, fcpxmlTime(offset), xmlEscape(input.Input.EntryName), fcpxmlTime(input.Media.Duration),
		)
		offset, err = addRational(offset, input.Media.Duration)
		if err != nil {
			return "", err
		}
	}
	body.WriteString("            </gap>\n          </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>\n")
	return body.String(), nil
}

func validateMediaInfo(info MediaInfo) error {
	if info.Width <= 0 || info.Height <= 0 || info.FrameDuration.Num <= 0 || info.FrameDuration.Den <= 0 ||
		info.FrameDuration.Den > maxFCPXMLTimeDenominator ||
		info.Duration.Num <= 0 || info.Duration.Den <= 0 || info.Duration.Den > maxFCPXMLTimeDenominator ||
		(info.HasAudio && (info.AudioChannels <= 0 || info.AudioRate <= 0)) {
		return ErrInvalidMedia
	}
	return nil
}

func sumDurations(inputs []probedInput) (Rational, error) {
	total := Rational{Num: 0, Den: 1}
	var err error
	for _, input := range inputs {
		total, err = addRational(total, input.Media.Duration)
		if err != nil {
			return Rational{}, err
		}
	}
	return total, nil
}

func addRational(left, right Rational) (Rational, error) {
	leftRat := new(big.Rat).SetFrac(big.NewInt(left.Num), big.NewInt(left.Den))
	rightRat := new(big.Rat).SetFrac(big.NewInt(right.Num), big.NewInt(right.Den))
	sum := new(big.Rat).Add(leftRat, rightRat)
	if !sum.Num().IsInt64() || !sum.Denom().IsInt64() {
		return Rational{}, errors.New("FCPXML timeline duration exceeds supported range")
	}
	if sum.Denom().Int64() > maxFCPXMLTimeDenominator {
		return Rational{}, fmt.Errorf("%w: FCPXML time denominator exceeds 32-bit range", ErrInvalidMedia)
	}
	return Rational{Num: sum.Num().Int64(), Den: sum.Denom().Int64()}, nil
}

func fcpxmlTime(value Rational) string {
	if value.Num == 0 {
		return "0s"
	}
	if value.Den == 1 {
		return fmt.Sprintf("%ds", value.Num)
	}
	return fmt.Sprintf("%d/%ds", value.Num, value.Den)
}

func sequenceAudio(inputs []probedInput) (string, string) {
	allowedRates := map[int]string{
		32000: "32k", 44100: "44.1k", 48000: "48k", 88200: "88.2k",
		96000: "96k", 176400: "176.4k", 192000: "192k",
	}
	for _, input := range inputs {
		if !input.Media.HasAudio {
			continue
		}
		rate, supported := allowedRates[input.Media.AudioRate]
		if !supported {
			continue
		}
		layout := "surround"
		switch input.Media.AudioChannels {
		case 1:
			layout = "mono"
		case 2:
			layout = "stereo"
		}
		return layout, rate
	}
	return "", ""
}

func stableUID(value string) string {
	digest := sha256.Sum256([]byte(value))
	hexValue := strings.ToUpper(hex.EncodeToString(digest[:16]))
	return fmt.Sprintf("%s-%s-%s-%s-%s", hexValue[:8], hexValue[8:12], hexValue[12:16], hexValue[16:20], hexValue[20:32])
}

func xmlEscape(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&#34;", "'", "&#39;").Replace(value)
}
