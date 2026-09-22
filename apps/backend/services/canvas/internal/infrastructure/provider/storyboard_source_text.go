package provider

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

var storyboardSceneHeadingPatterns = []*regexp.Regexp{
	regexp.MustCompile(`^\d+(?:[-.]\d+)+[,、.]?\s*(.+)$`),
	regexp.MustCompile(`^\d+[.、]\s*(.+)$`),
	regexp.MustCompile(`^第[0-9一二三四五六七八九十百千]+场[：:\s]*(.+)$`),
	regexp.MustCompile(`^场景[0-9一二三四五六七八九十百千]+[：:\s]*(.+)$`),
}

type storyboardBeatFacts struct {
	Scene        string
	Characters   []string
	Speakers     []string
	Props        []string
	PlayableText string
}

func parseStoryboardBeatFacts(text string) storyboardBeatFacts {
	var facts storyboardBeatFacts
	playable := make([]string, 0)
	for _, rawLine := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		if scene, ok := storyboardSceneHeading(line); ok {
			facts.Scene = scene
			continue
		}
		if characters, ok := storyboardCharacterList(line); ok {
			facts.Characters = appendUniqueStoryboardStrings(facts.Characters, characters...)
			continue
		}
		if props, ok := storyboardPropList(line); ok {
			facts.Props = appendUniqueStoryboardStrings(facts.Props, props...)
			continue
		}
		if speaker, _, ok := storyboardScreenplayLine(line); ok && storyboardVisualSpeaker(speaker) {
			facts.Speakers = appendUniqueStoryboardStrings(facts.Speakers, speaker)
		}
		if !storyboardNonPlayableMetadata(line) {
			playable = append(playable, line)
		}
	}
	facts.PlayableText = strings.Join(playable, "\n")
	return facts
}

func storyboardSceneHeading(line string) (string, bool) {
	line = normalizeStoryboardDetectionText(strings.Trim(strings.TrimSpace(line), "【】[]"))
	for _, pattern := range storyboardSceneHeadingPatterns {
		match := pattern.FindStringSubmatch(line)
		if len(match) != 2 {
			continue
		}
		if scene := strings.TrimSpace(match[1]); scene != "" {
			return scene, true
		}
	}
	return "", false
}

func normalizeStoryboardDetectionText(text string) string {
	// Normalize only the parser's detection copy. Source beats retain the original text.
	text = norm.NFKC.String(text)
	var normalized strings.Builder
	for _, character := range text {
		if unicode.Is(unicode.Dash, character) {
			normalized.WriteByte('-')
			continue
		}
		normalized.WriteRune(character)
	}
	return normalized.String()
}

func storyboardCharacterList(line string) ([]string, bool) {
	return storyboardLabeledList(line, "人物")
}

func storyboardPropList(line string) ([]string, bool) {
	return storyboardLabeledList(line, "道具")
}

func storyboardLabeledList(line string, label string) ([]string, bool) {
	line = strings.TrimSpace(line)
	value, ok := strings.CutPrefix(line, label+"：")
	if !ok {
		value, ok = strings.CutPrefix(line, label+":")
	}
	if !ok {
		return nil, false
	}
	fields := strings.FieldsFunc(value, func(value rune) bool {
		switch value {
		case '、', '，', ',', '；', ';', ' ':
			return true
		default:
			return false
		}
	})
	result := make([]string, 0, len(fields))
	for _, field := range fields {
		if field = strings.TrimSpace(field); field != "" {
			result = appendUniqueStoryboardStrings(result, field)
		}
	}
	return result, true
}

func storyboardScreenplayLine(line string) (string, string, bool) {
	label, texts, ok := storyboardScreenplayParts(line)
	if !ok {
		return "", "", false
	}
	return label, strings.Join(texts, ""), true
}

func storyboardScreenplayParts(line string) (string, []string, bool) {
	original := strings.TrimSpace(line)
	if strings.HasPrefix(original, "△") || strings.HasPrefix(original, "▲") ||
		strings.HasPrefix(original, "※") || strings.HasPrefix(original, "●") {
		return "", nil, false
	}
	trimmed := unwrapStoryboardLine(original)
	label, text, ok := strings.Cut(trimmed, "：")
	if !ok {
		label, text, ok = strings.Cut(trimmed, ":")
	}
	if !ok {
		return "", nil, false
	}
	label = strings.TrimSpace(label)
	text = strings.TrimSpace(text)
	if label == "" || text == "" {
		return "", nil, false
	}
	if index := strings.IndexAny(label, "（("); index > 0 {
		label = strings.TrimSpace(label[:index])
	}
	if storyboardProductionMetadataLabel(label) {
		return "", nil, false
	}
	texts := storyboardDialogueTexts(text)
	if len(texts) == 0 {
		return "", nil, false
	}
	return label, texts, true
}

func unwrapStoryboardLine(line string) string {
	line = strings.TrimSpace(line)
	for _, pair := range [][2]string{{"（", "）"}, {"(", ")"}, {"【", "】"}, {"[", "]"}} {
		if strings.HasPrefix(line, pair[0]) && strings.HasSuffix(line, pair[1]) {
			return strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(line, pair[0]), pair[1]))
		}
	}
	return line
}

func storyboardDialogueTexts(text string) []string {
	original := strings.TrimSpace(text)
	result := make([]string, 0, 2)
	var current strings.Builder
	depth := 0
	flush := func() {
		if value := strings.TrimSpace(current.String()); value != "" {
			result = append(result, value)
		}
		current.Reset()
	}
	for _, character := range original {
		switch character {
		case '（', '(':
			if depth == 0 {
				flush()
			}
			depth++
		case '）', ')':
			if depth > 0 {
				depth--
				continue
			}
			current.WriteRune(character)
		default:
			if depth == 0 {
				current.WriteRune(character)
			}
		}
	}
	if depth != 0 {
		return []string{original}
	}
	flush()
	return result
}

func storyboardEstimatedDurationSeconds(text string) int {
	units := storyboardEstimatedDurationUnits(text)
	return (units + storyboardDurationUnitsPerSec - 1) / storyboardDurationUnitsPerSec
}

func storyboardEstimatedDurationUnits(text string) int {
	total := 0
	for _, rawLine := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		if _, ok := storyboardSceneHeading(line); ok {
			continue
		}
		if _, ok := storyboardCharacterList(line); ok {
			continue
		}
		if _, ok := storyboardPropList(line); ok {
			continue
		}
		if storyboardNonPlayableMetadata(line) {
			continue
		}
		_, dialogueTexts, screenplay := storyboardScreenplayParts(line)
		if !screenplay {
			total += storyboardVisibleRuneCount(line) * storyboardNarrativeRuneUnits
			continue
		}
		dialogueRunes := 0
		for _, dialogue := range dialogueTexts {
			dialogueRunes += storyboardVisibleRuneCount(dialogue)
		}
		_, content, _ := strings.Cut(unwrapStoryboardLine(line), "：")
		if content == "" {
			_, content, _ = strings.Cut(unwrapStoryboardLine(line), ":")
		}
		narrativeRunes := max(storyboardVisibleRuneCount(content)-dialogueRunes, 0)
		total += dialogueRunes*storyboardDialogueRuneUnits + narrativeRunes*storyboardNarrativeRuneUnits
	}
	return total
}

func storyboardVisibleRuneCount(text string) int {
	count := 0
	for _, character := range text {
		if !unicode.IsSpace(character) {
			count++
		}
	}
	return count
}

func storyboardVisualSpeaker(speaker string) bool {
	switch strings.TrimSpace(speaker) {
	case "字幕", "画面文字", "系统", "旁白", "画外音", "OS", "ＯＳ", "VO", "ＶＯ":
		return false
	default:
		return true
	}
}

func storyboardProductionMetadataLabel(label string) bool {
	switch strings.TrimSpace(label) {
	case "人物", "道具", "时间", "地点", "镜头", "镜号", "特效", "备注", "集数", "动作", "环境", "氛围", "服化", "造型":
		return true
	default:
		return strings.Contains(label, "场景") || strings.Contains(label, "镜头")
	}
}

func storyboardNonPlayableMetadata(line string) bool {
	trimmed := strings.TrimSpace(line)
	if strings.Contains(trimmed, "字幕") || strings.Contains(trimmed, "画面文字") {
		return false
	}
	label, _, hasLabel := strings.Cut(trimmed, "：")
	if !hasLabel {
		label, _, hasLabel = strings.Cut(trimmed, ":")
	}
	if hasLabel && storyboardProductionMetadataLabel(strings.TrimSpace(label)) {
		return true
	}
	if strings.HasPrefix(trimmed, "【") && strings.HasSuffix(trimmed, "】") {
		return true
	}
	detection := unwrapStoryboardLine(trimmed)
	return strings.HasPrefix(detection, "承接上集") || strings.HasPrefix(detection, "承接上一集") ||
		strings.HasPrefix(detection, "接上集") || strings.HasPrefix(detection, "接上一集") ||
		(strings.HasPrefix(detection, "第") && strings.HasSuffix(detection, "集"))
}

func appendUniqueStoryboardStrings(values []string, additions ...string) []string {
	seen := make(map[string]struct{}, len(values)+len(additions))
	for _, value := range values {
		seen[strings.TrimSpace(value)] = struct{}{}
	}
	for _, addition := range additions {
		addition = strings.TrimSpace(addition)
		if addition == "" {
			continue
		}
		if _, exists := seen[addition]; exists {
			continue
		}
		seen[addition] = struct{}{}
		values = append(values, addition)
	}
	return values
}
