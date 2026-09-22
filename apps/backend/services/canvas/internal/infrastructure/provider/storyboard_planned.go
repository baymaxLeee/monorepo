package provider

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/volcengine/volcengine-go-sdk/service/arkruntime/model/responses"

	applicationcanvasnode "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
)

const storyboardPlannedSystemPrompt = `你是电影导演兼分镜导演。总体规划模型已经通读完整原剧情，服务端已校验并冻结当前 1-3 个分镜的事实骨架；本轮只把它展开为可独立提交给视频生成模型的详细镜头脚本。

直接且只调用一次 create_canvas_nodes，不提问，不返回文本；一次 tool call 的 canvas_nodes 数组生成 1-3 个分镜，不得调用多个 tool。不得重新规划、合并、拆分、重排或提交其他编号。

每个 canvasnode 只输出 canvasnode_no、summary 和 shots。summary 是不超过 40 个汉字的一句纯文本剧情概述，只写本分镜的核心人物、动作与结果；不得逐行复述对白，不得包含换行、△/▲/※/●、镜头编号、模块标题或制作标记。全局设定和位置参考由服务端从冻结骨架注入，禁止在 tool 参数中生成或改写。一个分镜可以且通常应包含多个 shots；shots 按时间顺序写 duration_seconds 和 script。

前端传入的分镜时长和视频总时长都是创作参考范围，不是严格限制，不要求逼近前端范围上限。分镜应在同一场景、同一连续动作链和同一叙事目标内尽量容纳多段连续剧情，尽量利用视频模型硬时长上限，避免几句话就拆成一个分镜；但不得为了凑时长增加慢动作、静止凝视、空镜、重复反应、无意义运镜或虚构剧情。target_duration_seconds 仅为规划参考；详细 shots 应让完整对白、动作和反应形成连续可拍的段落，并落在视频模型的硬能力范围内。

逐字保留原文对白、OS、VO及画面文字，发言人标签写在引号外；按每秒约4个有效中文字符估算自然语速并给动作和反应留出时间。不得新增、删减或改写剧情信息。心理活动必须转成可见动作和表演。只写同期声、环境声和动作音效，禁止 BGM 和多余台词；禁止新增字幕，但原文明示的字幕必须逐字呈现。

角色冒号后的括号内容、△动作、【镜头画面】和【特效】都是表演或画面指令，必须转成纯文本画面描述，输出中不得保留△/▲/※/●或单独的制作标记行，绝不能让角色念出括号或指令文字。同一动作若先在对白括号中预告、随后又由△或特效段详细说明，只按更详细的动作说明完整呈现一次，不能在相邻分镜中重复表演。

本轮不选择、不引用任何素材，不输出 asset_references、素材 ID、@、@@ 或 HTML mention。优先保证 JSON 与必填字段完整。`

func storyboardDetailRequest(
	model applicationmodel.Selection,
	plan storyboardPlan,
	batch []storyboardPlanItem,
	beats []storyboardSourceBeat,
	constraints applicationcanvasnode.StoryboardConstraints,
	feedback string,
) (*responses.ResponsesRequest, error) {
	minimum, maximum := storyboardVideoDurationBounds(constraints)
	schema, err := storyboardToolSchemaForBatch(maximum, plan.PlannedCanvasNodeCount, storyboardPlanItemNumbers(batch))
	if err != nil {
		return nil, fmt.Errorf("encode storyboard detail schema: %w", err)
	}
	beatByID := make(map[string]storyboardSourceBeat, len(beats))
	for _, beat := range beats {
		beatByID[beat.ID] = beat
	}
	batchBeats := make([]storyboardSourceBeat, 0)
	for _, item := range batch {
		for _, id := range item.SourceBeatIDs {
			batchBeats = append(batchBeats, beatByID[id])
		}
	}
	adjacentContext := storyboardAdjacentContinuityContext(plan, batch)
	batchJSON, err := json.Marshal(batch)
	if err != nil {
		return nil, fmt.Errorf("marshal frozen batch plan: %w", err)
	}
	beatJSON, err := json.Marshal(batchBeats)
	if err != nil {
		return nil, fmt.Errorf("marshal frozen source beats: %w", err)
	}
	adjacentJSON, err := json.Marshal(adjacentContext)
	if err != nil {
		return nil, fmt.Errorf("marshal adjacent continuity context: %w", err)
	}
	numberJSON, err := json.Marshal(storyboardPlanItemNumbers(batch))
	if err != nil {
		return nil, fmt.Errorf("marshal expected canvas node numbers: %w", err)
	}
	user := fmt.Sprintf(`每次生成 1-3 个分镜；当前只展开以下冻结批次。

planned_canvasnode_count: %d
expected_canvasnode_no: %s
frozen_batch_plan: %s
frozen_source_beats: %s
adjacent_continuity_context: %s（只描述相邻分镜边界，不含相邻原文；只用于衔接，不得重演、提前或计入当前分镜）
preferred_canvasnode_duration_seconds_range: %s（参考范围，不要求逼近前端范围上限）
preferred_total_duration_seconds_range: %s（参考范围）
video_model_hard_duration_seconds_range: %d-%d 秒
video_generation_spec: %s

target_duration_seconds 仅为规划参考；shots 时长之和按剧情自然容量决定，不要求与它相等。同一冻结分镜内应连续呈现完整剧情段落，并在不注水的前提下尽量利用 video_model_hard_duration_seconds_range 的上限。`,
		plan.PlannedCanvasNodeCount, numberJSON, batchJSON, beatJSON, adjacentJSON,
		storyboardDurationRange(constraints), storyboardTotalDurationRange(constraints), minimum, maximum,
		storyboardVideoSpecification(constraints),
	)
	if strings.TrimSpace(feedback) != "" {
		user += "\n\n上一轮未通过结构校验；只修复当前 expected_canvasnode_no：" + feedback
	}
	return storyboardForcedToolRequest(
		model, schema, storyboardToolName,
		"一次 tool call 生成当前 1-3 个完整分镜；不得选择素材，在不注水的前提下尽量利用视频模型硬时长上限。",
		[]*responses.InputItem{
			responseInputMessage(responses.MessageRole_system, storyboardPlannedSystemPrompt),
			responseInputMessage(responses.MessageRole_user, user),
		},
	), nil
}

type storyboardContinuityBoundary struct {
	Relation          string   `json:"relation"`
	CanvasNodeNo      int      `json:"canvasnode_no"`
	Summary           string   `json:"summary"`
	Scene             string   `json:"scene"`
	Characters        []string `json:"characters"`
	PositionReference string   `json:"position_reference"`
}

func storyboardAdjacentContinuityContext(
	plan storyboardPlan,
	batch []storyboardPlanItem,
) []storyboardContinuityBoundary {
	if len(batch) == 0 {
		return []storyboardContinuityBoundary{}
	}
	first := batch[0]
	last := batch[len(batch)-1]
	result := make([]storyboardContinuityBoundary, 0, 2)
	if item, exists := plannedStoryboardItem(plan.CanvasNodes, first.Number-1); exists &&
		strings.TrimSpace(item.ContinuityGroup) == strings.TrimSpace(first.ContinuityGroup) {
		result = append(result, storyboardContinuityBoundary{
			Relation: "previous", CanvasNodeNo: item.Number, Summary: item.Summary,
			Scene: item.Scene, Characters: append([]string(nil), item.Characters...),
			PositionReference: item.PositionReference,
		})
	}
	if item, exists := plannedStoryboardItem(plan.CanvasNodes, last.Number+1); exists &&
		strings.TrimSpace(item.ContinuityGroup) == strings.TrimSpace(last.ContinuityGroup) {
		result = append(result, storyboardContinuityBoundary{
			Relation: "next", CanvasNodeNo: item.Number, Summary: item.Summary,
			Scene: item.Scene, Characters: append([]string(nil), item.Characters...),
			PositionReference: item.PositionReference,
		})
	}
	return result
}

func validateFrozenStoryboardPlan(
	plan storyboardPlan,
	beats []storyboardSourceBeat,
	constraints applicationcanvasnode.StoryboardConstraints,
) error {
	if plan.PlannedCanvasNodeCount < 1 || plan.PlannedCanvasNodeCount > storyboardMaxModelCalls || plan.PlannedCanvasNodeCount != len(plan.CanvasNodes) {
		return errors.New("planned_canvasnode_count must equal canvas_nodes length")
	}
	minimum, maximum := storyboardVideoDurationBounds(constraints)
	expectedBeats := make(map[string]struct{}, len(beats))
	for _, beat := range beats {
		expectedBeats[beat.ID] = struct{}{}
	}
	seenBeats := make(map[string]struct{}, len(beats))
	nextBeat := 0
	for index, item := range plan.CanvasNodes {
		if item.Number != index+1 || strings.TrimSpace(item.Summary) == "" || len(item.SourceBeatIDs) == 0 {
			return fmt.Errorf("canvas_nodes[%d] must have a consecutive number, summary and source beats", index)
		}
		if strings.TrimSpace(item.Scene) == "" || strings.TrimSpace(item.ContinuityGroup) == "" ||
			strings.TrimSpace(item.PositionReference) == "" || item.Characters == nil || item.Props == nil || item.AssetRequirements == nil {
			return fmt.Errorf("canvas_nodes[%d] must freeze scene, continuity, entities, position and asset requirements", index)
		}
		if item.TargetDurationSeconds < minimum || (maximum > 0 && item.TargetDurationSeconds > maximum) {
			return fmt.Errorf("canvas_nodes[%d] target duration is outside the video model capability", index)
		}
		for _, id := range item.SourceBeatIDs {
			if _, exists := expectedBeats[id]; !exists {
				return fmt.Errorf("canvas_nodes[%d] references unknown source beat %q", index, id)
			}
			if _, duplicate := seenBeats[id]; duplicate {
				return fmt.Errorf("source beat %q was assigned more than once", id)
			}
			if nextBeat >= len(beats) || beats[nextBeat].ID != id {
				return fmt.Errorf("source beats must follow original order")
			}
			nextBeat++
			seenBeats[id] = struct{}{}
		}
	}
	if len(seenBeats) != len(expectedBeats) {
		return errors.New("the storyboard plan did not cover every source beat exactly once")
	}
	return nil
}

func processFrozenStoryboardCanvasNode(
	raw, callID string,
	batch []storyboardPlanItem,
	beats []storyboardSourceBeat,
	accepted map[int]struct{},
	constraints applicationcanvasnode.StoryboardConstraints,
	emit func(applicationcanvasnode.StoryboardDraft) error,
) (storyboardCanvasNodeProcessResult, error) {
	var canvasnode storyboardCanvasNode
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&canvasnode); err != nil {
		return storyboardCanvasNodeProcessResult{Rejection: err.Error(), RejectionRule: "invalid_json"}, nil
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return storyboardCanvasNodeProcessResult{AttemptedNumber: canvasnode.Number, Rejection: err.Error(), RejectionRule: "invalid_json"}, nil
	}
	item, exists := plannedStoryboardItem(batch, canvasnode.Number)
	if !exists {
		return storyboardCanvasNodeProcessResult{AttemptedNumber: canvasnode.Number, Rejection: "canvasnode_no is outside the current frozen batch", RejectionRule: "out_of_plan_canvasnode_no"}, nil
	}
	if _, duplicate := accepted[canvasnode.Number]; duplicate {
		return storyboardCanvasNodeProcessResult{AttemptedNumber: canvasnode.Number, Rejection: "canvasnode_no was already accepted", RejectionRule: "already_accepted"}, nil
	}
	canvasnode.Summary = strings.TrimSpace(canvasnode.Summary)
	canvasnode.GlobalSetting = frozenStoryboardGlobalSetting(item)
	canvasnode.PositionReference = frozenStoryboardPositionReference(item)
	if summaryErr := validateStoryboardSummary(canvasnode.Summary); summaryErr != "" {
		return storyboardCanvasNodeProcessResult{AttemptedNumber: canvasnode.Number, Rejection: summaryErr, RejectionRule: "invalid_summary"}, nil
	}
	if markerErr := validateStoryboardShotText(canvasnode.Shots); markerErr != "" {
		return storyboardCanvasNodeProcessResult{AttemptedNumber: canvasnode.Number, Rejection: markerErr, RejectionRule: "production_marker_in_shots"}, nil
	}
	if structureErr := validateStoryboardCanvasNodeStructure(canvasnode); structureErr != "" {
		return storyboardCanvasNodeProcessResult{AttemptedNumber: canvasnode.Number, Rejection: structureErr, RejectionRule: storyboardValidationRule(structureErr)}, nil
	}
	if verbatimErr := validateStoryboardVerbatimText(canvasnode, item, beats); verbatimErr != "" {
		return storyboardCanvasNodeProcessResult{AttemptedNumber: canvasnode.Number, Rejection: verbatimErr, RejectionRule: "source_text_omitted"}, nil
	}
	if foreignErr := validateStoryboardForeignVerbatimText(canvasnode, item, batch, beats); foreignErr != "" {
		return storyboardCanvasNodeProcessResult{AttemptedNumber: canvasnode.Number, Rejection: foreignErr, RejectionRule: "neighbor_text_repeated"}, nil
	}
	duration, durationErr := storyboardCanvasNodeDuration(canvasnode)
	minimum, maximum := storyboardVideoDurationBounds(constraints)
	if durationErr != "" || duration < minimum || (maximum > 0 && duration > maximum) {
		reason := durationErr
		if reason == "" {
			reason = fmt.Sprintf("shots duration sum %d must be within video model capability %d-%d seconds", duration, minimum, maximum)
		}
		return storyboardCanvasNodeProcessResult{AttemptedNumber: canvasnode.Number, Rejection: reason, RejectionRule: "duration_out_of_range"}, nil
	}
	canvasnode.DurationSeconds = duration
	draft := applicationcanvasnode.StoryboardDraft{
		ID: callID + ":" + strconv.Itoa(canvasnode.Number), CanvasNodeNo: canvasnode.Number,
		DurationSeconds: int32(duration), Prompt: compileStoryboardPrompt(canvasnode, constraints),
	}
	if err := emit(draft); err != nil {
		return storyboardCanvasNodeProcessResult{}, err
	}
	accepted[canvasnode.Number] = struct{}{}
	return storyboardCanvasNodeProcessResult{Number: canvasnode.Number, AttemptedNumber: canvasnode.Number}, nil
}

func validateStoryboardSummary(summary string) string {
	if summary == "" || strings.ContainsAny(summary, "\r\n") {
		return "summary must be one non-empty plain-text sentence without line breaks"
	}
	if utf8.RuneCountInString(summary) > 60 {
		return "summary must contain at most 60 characters"
	}
	for _, marker := range []string{"△", "▲", "※", "●", "【", "】", "[镜头"} {
		if strings.Contains(summary, marker) {
			return "summary must not contain screenplay or production markers"
		}
	}
	return ""
}

func validateStoryboardShotText(shots []storyboardShot) string {
	for _, shot := range shots {
		for _, rawLine := range strings.Split(strings.ReplaceAll(shot.Script, "\r\n", "\n"), "\n") {
			line := strings.TrimSpace(rawLine)
			if line == "" {
				continue
			}
			if strings.ContainsRune("△▲※●", []rune(line)[0]) ||
				(strings.HasPrefix(line, "【") && strings.HasSuffix(line, "】")) {
				return "shots must convert screenplay production markers into plain-text visual descriptions"
			}
		}
	}
	return ""
}

func validateStoryboardVerbatimText(
	canvasnode storyboardCanvasNode,
	item storyboardPlanItem,
	beats []storyboardSourceBeat,
) string {
	beatByID := make(map[string]string, len(beats))
	for _, beat := range beats {
		beatByID[beat.ID] = beat.Text
	}
	var source strings.Builder
	for _, id := range item.SourceBeatIDs {
		source.WriteString(beatByID[id])
		source.WriteByte('\n')
	}
	var scripts strings.Builder
	for _, shot := range canvasnode.Shots {
		scripts.WriteString(shot.Script)
		scripts.WriteByte('\n')
	}
	for _, text := range storyboardRequiredVerbatimTexts(source.String()) {
		if !strings.Contains(scripts.String(), text) {
			return fmt.Sprintf("shots must preserve required source dialogue or on-screen text exactly: %q", text)
		}
	}
	return ""
}

func validateStoryboardForeignVerbatimText(
	canvasnode storyboardCanvasNode,
	item storyboardPlanItem,
	batch []storyboardPlanItem,
	beats []storyboardSourceBeat,
) string {
	beatByID := make(map[string]string, len(beats))
	for _, beat := range beats {
		beatByID[beat.ID] = beat.Text
	}
	own := make(map[string]struct{})
	for _, id := range item.SourceBeatIDs {
		for _, text := range storyboardRequiredVerbatimTexts(beatByID[id]) {
			own[text] = struct{}{}
		}
	}
	var scripts strings.Builder
	for _, shot := range canvasnode.Shots {
		scripts.WriteString(shot.Script)
		scripts.WriteByte('\n')
	}
	for _, other := range batch {
		if other.Number == item.Number {
			continue
		}
		for _, id := range other.SourceBeatIDs {
			for _, text := range storyboardRequiredVerbatimTexts(beatByID[id]) {
				if _, alsoOwned := own[text]; alsoOwned {
					continue
				}
				if strings.Contains(scripts.String(), text) {
					return fmt.Sprintf("shots must not repeat dialogue or on-screen text owned by canvasnode %d: %q", other.Number, text)
				}
			}
		}
	}
	return ""
}

func storyboardRequiredVerbatimTexts(source string) []string {
	result := storyboardQuotedTexts(source)
	seen := make(map[string]struct{}, len(result))
	for _, text := range result {
		seen[text] = struct{}{}
	}
	for _, line := range strings.Split(strings.ReplaceAll(source, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if _, texts, ok := storyboardScreenplayParts(line); ok {
			for _, text := range texts {
				if _, exists := seen[text]; exists {
					continue
				}
				seen[text] = struct{}{}
				result = append(result, text)
			}
		}
		for _, text := range storyboardOnScreenTexts(line) {
			if _, exists := seen[text]; exists {
				continue
			}
			seen[text] = struct{}{}
			result = append(result, text)
		}
	}
	return result
}

func storyboardOnScreenTexts(line string) []string {
	markers := []string{"字幕：", "字幕:", "画面文字：", "画面文字:"}
	result := make([]string, 0, 1)
	for _, marker := range markers {
		remaining := line
		for {
			index := strings.Index(remaining, marker)
			if index < 0 {
				break
			}
			value := strings.TrimSpace(remaining[index+len(marker):])
			if end := strings.IndexAny(value, "）)】]"); end >= 0 {
				value = strings.TrimSpace(value[:end])
			}
			if value != "" {
				result = appendUniqueStoryboardStrings(result, value)
			}
			remaining = remaining[index+len(marker):]
		}
	}
	return result
}

func frozenStoryboardGlobalSetting(item storyboardPlanItem) string {
	scene := strings.TrimSpace(item.Scene)
	if scene == "" {
		scene = "原剧情明确的场景"
	}
	characters := strings.Join(item.Characters, "、")
	if characters == "" {
		characters = "原剧情中本分镜出现的人物"
	}
	return fmt.Sprintf("严格保持冻结连续性组 %s；场景固定为%s；人物固定为%s，不改变地点、内外景、昼夜、身份或服装状态，不添加原文以外的事件。",
		strings.TrimSpace(item.ContinuityGroup), scene, characters) + "当前出镜身份、造型与道具约束：" + strings.Join(item.AssetRequirements, "；")
}

func frozenStoryboardPositionReference(item storyboardPlanItem) string {
	if value := strings.TrimSpace(item.PositionReference); value != "" {
		return value
	}
	return fmt.Sprintf("第一帧固定在%s，建立人物、道具、朝向、视线和前后景关系；人物：%s。",
		strings.TrimSpace(item.Scene), strings.Join(item.Characters, "、"))
}

func storyboardQuotedTexts(source string) []string {
	pairs := map[rune]rune{'“': '”', '「': '」', '『': '』', '"': '"'}
	runes := []rune(source)
	result := make([]string, 0)
	for index := 0; index < len(runes); index++ {
		closing, ok := pairs[runes[index]]
		if !ok {
			continue
		}
		for end := index + 1; end < len(runes); end++ {
			if runes[end] != closing {
				continue
			}
			if text := strings.TrimSpace(string(runes[index+1 : end])); text != "" {
				result = append(result, text)
			}
			index = end
			break
		}
	}
	return result
}

func storyboardVideoDurationBounds(constraints applicationcanvasnode.StoryboardConstraints) (int, int) {
	minimum := int(constraints.VideoDurationMinSeconds)
	maximum := int(constraints.VideoDurationMaxSeconds)
	if minimum < 1 {
		minimum = int(constraints.DurationMinSeconds)
	}
	if maximum < 1 {
		maximum = int(constraints.DurationMaxSeconds)
	}
	return max(minimum, 1), maximum
}

func fallbackStoryboardDrafts(
	items []storyboardPlanItem,
	beats []storyboardSourceBeat,
	constraints applicationcanvasnode.StoryboardConstraints,
) []applicationcanvasnode.StoryboardDraft {
	beatByID := make(map[string]string, len(beats))
	for _, beat := range beats {
		beatByID[beat.ID] = strings.TrimSpace(beat.Text)
	}
	minimum, maximum := storyboardVideoDurationBounds(constraints)
	drafts := make([]applicationcanvasnode.StoryboardDraft, 0, len(items))
	for _, item := range items {
		duration := item.TargetDurationSeconds
		if duration < minimum {
			duration = minimum
		}
		if maximum > 0 && duration > maximum {
			duration = maximum
		}
		texts := make([]string, 0, len(item.SourceBeatIDs))
		for _, id := range item.SourceBeatIDs {
			if text := beatByID[id]; text != "" {
				if plain := plainStoryboardFallbackText(text); plain != "" {
					texts = append(texts, plain)
				}
			}
		}
		if len(texts) == 0 {
			texts = append(texts, strings.TrimSpace(item.Summary))
		}
		shotCount := min(len(texts), min(12, max(duration/2, 1)))
		shots := make([]storyboardShot, 0, shotCount)
		for index := 0; index < shotCount; index++ {
			start := index * len(texts) / shotCount
			end := (index + 1) * len(texts) / shotCount
			seconds := duration / shotCount
			if index < duration%shotCount {
				seconds++
			}
			shots = append(shots, storyboardShot{
				DurationSeconds: float64(seconds),
				Script:          "固定镜头保持动作与对白连续，完整呈现原剧情：" + strings.Join(texts[start:end], "\n"),
			})
		}
		position := strings.TrimSpace(item.PositionReference)
		if position == "" {
			position = fmt.Sprintf("第一帧建立%s中的人物与空间关系；人物：%s；道具：%s。",
				strings.TrimSpace(item.Scene), strings.Join(item.Characters, "、"), strings.Join(item.Props, "、"))
		}
		canvasnode := storyboardCanvasNode{
			Number: item.Number, Summary: fallbackStoryboardSummary(item),
			GlobalSetting:     "保持冻结剧情的场景、时代、光线和人物连续性，不添加原文以外的事件。场景：" + strings.TrimSpace(item.Scene) + "。",
			PositionReference: position, Shots: shots,
		}
		drafts = append(drafts, applicationcanvasnode.StoryboardDraft{
			ID: "storyboard-fallback:" + strconv.Itoa(item.Number), CanvasNodeNo: item.Number,
			DurationSeconds: int32(duration), Prompt: compileStoryboardPrompt(canvasnode, constraints),
		})
	}
	return drafts
}

func plainStoryboardFallbackText(text string) string {
	lines := make([]string, 0)
	for _, rawLine := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || storyboardNonPlayableMetadata(line) {
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
		line = strings.TrimLeftFunc(line, func(character rune) bool {
			return unicode.IsSpace(character) || strings.ContainsRune("△▲※●", character)
		})
		if strings.HasPrefix(line, "【") && strings.HasSuffix(line, "】") {
			line = unwrapStoryboardLine(line)
		}
		if line != "" {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

func fallbackStoryboardSummary(item storyboardPlanItem) string {
	scene := strings.TrimSpace(item.Scene)
	characters := append([]string(nil), item.Characters...)
	if len(characters) > 3 {
		characters = characters[:3]
	}
	subject := strings.Join(characters, "、")
	switch {
	case subject != "" && scene != "":
		return subject + "在" + scene + "推进当前剧情。"
	case subject != "":
		return subject + "推进当前剧情。"
	case scene != "":
		return scene + "中的关键事件继续推进。"
	default:
		return "当前剧情的关键事件继续推进。"
	}
}
