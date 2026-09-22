package aigw

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	applicationcanvasnode "github.com/example/monorepo/canvas/internal/application/canvas"
)

const (
	storyboardToolName = "create_canvas_nodes"
)

type storyboardCanvasNode struct {
	Number            int              `json:"canvasnode_no"`
	Summary           string           `json:"summary"`
	GlobalSetting     string           `json:"global_setting"`
	PositionReference string           `json:"position_reference"`
	Shots             []storyboardShot `json:"shots"`
	DurationSeconds   int              `json:"-"`
}

type storyboardShot struct {
	DurationSeconds float64 `json:"duration_seconds"`
	Script          string  `json:"script"`
}

type storyboardBatch struct {
	PlannedCanvasNodeCount int                    `json:"planned_canvasnode_count"`
	CanvasNodes            []storyboardCanvasNode `json:"canvas_nodes"`
}

type storyboardPlanItem = applicationcanvasnode.StoryboardPlanItem

type storyboardPlan struct {
	PlannedCanvasNodeCount int                  `json:"planned_canvasnode_count"`
	CanvasNodes            []storyboardPlanItem `json:"canvas_nodes"`
}

type storyboardSourceBeat = applicationcanvasnode.StoryboardSourceBeat

func storyboardToolSchemaForBatch(
	durationMaximum int,
	plannedCount int,
	allowedNumbers []int,
) ([]byte, error) {
	shotSchema := objectSchema(map[string]any{
		"duration_seconds": numberRangeSchema(1.5, float64(durationMaximum)),
		"script":           textSchema(3000),
	})
	canvasnodeProperties := map[string]any{
		"canvasnode_no": positiveIntegerSchema(),
		"summary":       textSchema(60),
		"shots":         arraySchema(1, 12, shotSchema),
	}
	if len(allowedNumbers) > 0 {
		canvasnodeProperties["canvasnode_no"] = map[string]any{"type": "integer", "enum": allowedNumbers}
	}
	canvasnodeSchema := objectSchema(canvasnodeProperties)
	// Struct field order is intentional. AIGW streams function arguments before
	// arguments.done, so the frozen count must arrive before the potentially
	// long canvas_nodes array and remain recoverable after output truncation.
	type storyboardToolProperties struct {
		PlannedCanvasNodeCount any `json:"planned_canvasnode_count"`
		CanvasNodes            any `json:"canvas_nodes"`
	}
	type storyboardToolRoot struct {
		Type                 string                   `json:"type"`
		AdditionalProperties bool                     `json:"additionalProperties"`
		Properties           storyboardToolProperties `json:"properties"`
		Required             []string                 `json:"required"`
	}
	plannedCountSchema := map[string]any{"type": "integer", "enum": []int{plannedCount}}
	canvasNodesSchema := arraySchema(1, len(allowedNumbers), canvasnodeSchema)
	return json.Marshal(storyboardToolRoot{
		Type: "object", AdditionalProperties: false,
		Properties: storyboardToolProperties{
			PlannedCanvasNodeCount: plannedCountSchema,
			CanvasNodes:            canvasNodesSchema,
		},
		Required: []string{"planned_canvasnode_count", "canvas_nodes"},
	})
}

func objectSchema(properties map[string]any) map[string]any {
	required := make([]string, 0, len(properties))
	for name := range properties {
		required = append(required, name)
	}
	sort.Strings(required)
	return map[string]any{"type": "object", "additionalProperties": false, "properties": properties, "required": required}
}

func arraySchema(minimum, maximum int, items any) map[string]any {
	return map[string]any{"type": "array", "minItems": minimum, "maxItems": maximum, "items": items}
}

func textSchema(maxLength int) map[string]any {
	return map[string]any{"type": "string", "minLength": 1, "maxLength": maxLength}
}

func positiveIntegerSchema() map[string]any {
	return map[string]any{"type": "integer", "minimum": 1}
}

func numberRangeSchema(minimum, maximum float64) map[string]any {
	schema := map[string]any{"type": "number", "minimum": minimum}
	if maximum > 0 {
		schema["maximum"] = maximum
	}
	return schema
}

func stringEnum(values ...string) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}

func validateStoryboardCanvasNodeStructure(canvasnode storyboardCanvasNode) string {
	if strings.TrimSpace(canvasnode.Summary) == "" || strings.TrimSpace(canvasnode.GlobalSetting) == "" ||
		strings.TrimSpace(canvasnode.PositionReference) == "" || len(canvasnode.Shots) == 0 {
		return "summary, global_setting, position_reference and shots are required"
	}
	for index, shot := range canvasnode.Shots {
		if shot.DurationSeconds < 1.5 || strings.TrimSpace(shot.Script) == "" {
			return fmt.Sprintf("shots[%d] must have duration_seconds >= 1.5 and a non-empty script", index)
		}
	}
	return ""
}

func storyboardCanvasNodeDuration(canvasnode storyboardCanvasNode) (int, string) {
	total := 0.0
	for _, shot := range canvasnode.Shots {
		total += shot.DurationSeconds
	}
	rounded := math.Round(total)
	if math.Abs(total-rounded) > 0.01 {
		return 0, fmt.Sprintf("shots duration sum %.1f must be a whole number of seconds", total)
	}
	return int(rounded), ""
}

func compileStoryboardPrompt(canvasnode storyboardCanvasNode, constraints applicationcanvasnode.StoryboardConstraints) string {
	var b strings.Builder
	duration, _ := storyboardCanvasNodeDuration(canvasnode)
	fmt.Fprintf(&b, "### %02d｜时长：%ds\n\n", canvasnode.Number, duration)
	writePromptModule(&b, "一句话概述", canvasnode.Summary)
	writePromptModule(&b, "全局设定", storyboardGlobalSetting(canvasnode.GlobalSetting, constraints))
	writePromptModule(&b, "位置参考", canvasnode.PositionReference)
	b.WriteString("【镜头脚本】\n")
	for index, shot := range canvasnode.Shots {
		if index > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "[镜头%d｜约%ss] %s", index+1, formatStoryboardSeconds(shot.DurationSeconds), strings.TrimSpace(shot.Script))
	}
	return b.String()
}

func storyboardGlobalSetting(value string, constraints applicationcanvasnode.StoryboardConstraints) string {
	parameters := constraints.VideoParameters
	audio := "有声生成，仅保留剧情原文台词、同期声、环境声和动作音效"
	if !parameters.GenerateAudio {
		audio = "无声生成，台词原文只用于口型和表演节奏，不生成任何声音"
	}
	watermark := "禁止水印"
	if parameters.Watermark {
		watermark = "允许模型水印"
	}
	hardConstraints := fmt.Sprintf(
		"画幅%s，输出分辨率%s，%s，%s；禁止新增字幕，原文明确要求的字幕或画面文字必须逐字保留；禁止背景音乐/BGM/配乐，禁止多余台词；人物光线只来自场景内合理环境光源，构图避免人物长期居中直视镜头。",
		parameters.AspectRatio.ProviderValue(), parameters.Resolution.ProviderValue(), audio, watermark,
	)
	return hardConstraints + strings.TrimSpace(value)
}

func storyboardVideoSpecification(constraints applicationcanvasnode.StoryboardConstraints) string {
	parameters := constraints.VideoParameters
	return fmt.Sprintf("resolution=%s, aspect_ratio=%s, generate_audio=%t, watermark=%t",
		parameters.Resolution.ProviderValue(), parameters.AspectRatio.ProviderValue(), parameters.GenerateAudio, parameters.Watermark)
}

func formatStoryboardSeconds(value float64) string {
	return strconv.FormatFloat(value, 'f', 1, 64)
}

func writePromptModule(b *strings.Builder, label, value string) {
	b.WriteString("【")
	b.WriteString(label)
	b.WriteString("】\n")
	b.WriteString(strings.TrimSpace(value))
	b.WriteString("\n\n")
}
