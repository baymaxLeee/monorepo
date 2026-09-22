package aigw

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"

	"github.com/volcengine/volcengine-go-sdk/service/arkruntime/model/responses"
	"go.uber.org/zap"

	applicationcanvasnode "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
	platformaigwproxy "github.com/example/monorepo/canvas/internal/infrastructure/provider/client"
)

const (
	storyboardMaxNoProgressRounds = 3
	storyboardMaxDiagnostics      = 16
	progressiveScanStrideBytes    = 1024
	storyboardPlannedBatchSize    = 3
	// Integer units model screenplay-wide timing without depending on any story entity.
	storyboardDurationUnitsPerSec = 20
	storyboardNarrativeRuneUnits  = 2
	storyboardDialogueRuneUnits   = 5
	storyboardMaxModelCalls       = 320
)

type StoryboardSplitter struct {
	client            platformaigwproxy.Client
	log               *zap.Logger
	workerConcurrency int
}

type storyboardCanvasNodeProcessResult struct {
	Number          int
	AttemptedNumber int
	Rejection       string
	RejectionRule   string
}

type storyboardRepairRejection struct {
	CanvasNodeNo *int   `json:"canvasnode_no,omitempty"`
	InputIndex   *int   `json:"input_index,omitempty"`
	Rule         string `json:"rule"`
	Message      string `json:"message"`
}

type storyboardRepairNextAction struct {
	Tool                       string `json:"tool"`
	SubmitOnlyCanvasNodeNumber []int  `json:"submit_only_canvasnode_no"`
}

type storyboardRepairFeedback struct {
	Status                   string                      `json:"status"`
	PlannedCanvasNodeCount   int                         `json:"planned_canvasnode_count"`
	AcceptedCanvasNodeNumber []int                       `json:"accepted_canvasnode_no"`
	MissingCanvasNodeNumber  []int                       `json:"missing_canvasnode_no"`
	Rejections               []storyboardRepairRejection `json:"rejections"`
	NextAction               *storyboardRepairNextAction `json:"next_action,omitempty"`
}

type storyboardCanvasNodeConsumer func(callID string, ordinal int, raw string) (storyboardCanvasNodeProcessResult, error)

type storyboardArgumentFingerprint struct {
	Size int
	Hash uint64
}

type storyboardCanvasNodeScanner struct {
	offset                                          int
	canvasnodeStart, canvasnodeEnd, canvasnodeDepth int
	arrayStarted, arrayClosed, rootClosed           bool
	inString, escaped                               bool
}

func (s *storyboardCanvasNodeScanner) scan(value []byte) []string {
	canvas_nodes := make([]string, 0)
	for index := s.offset; index < len(value); index++ {
		character := value[index]
		if s.inString {
			switch {
			case s.escaped:
				s.escaped = false
			case character == '\\':
				s.escaped = true
			case character == '"':
				s.inString = false
			}
			continue
		}
		if character == '"' {
			s.inString = true
			continue
		}
		if !s.arrayStarted {
			if character == '[' {
				s.arrayStarted = true
			}
			continue
		}
		if s.arrayClosed {
			if character == '}' {
				s.rootClosed = true
			}
			continue
		}
		if s.canvasnodeDepth == 0 {
			switch character {
			case '{':
				s.canvasnodeStart = index
				s.canvasnodeDepth = 1
			case ']':
				s.arrayClosed = true
			}
			continue
		}
		switch character {
		case '{', '[':
			s.canvasnodeDepth++
		case '}', ']':
			s.canvasnodeDepth--
			if s.canvasnodeDepth == 0 {
				s.canvasnodeEnd = index
				canvas_nodes = append(canvas_nodes, string(value[s.canvasnodeStart:index+1]))
			}
		}
	}
	s.offset = len(value)
	return canvas_nodes
}

type storyboardStreamCall struct {
	callID, name      string
	arguments         []byte
	scanner           storyboardCanvasNodeScanner
	processed         map[storyboardArgumentFingerprint]struct{}
	rejections        []string
	repairRejections  []storyboardRepairRejection
	rawCanvasNodes    int
	declaredCount     int
	declaredCountSeen bool
	argumentsComplete bool
	extra             bool
}

func newStoryboardStreamCall(callID, name string, extra bool) *storyboardStreamCall {
	return &storyboardStreamCall{
		callID: callID, name: name, extra: extra,
		processed: make(map[storyboardArgumentFingerprint]struct{}),
	}
}

func (c *storyboardStreamCall) appendArguments(
	value string,
	force bool,
	consume storyboardCanvasNodeConsumer,
) error {
	if value != "" {
		c.arguments = append(c.arguments, value...)
	}
	c.captureDeclaredCount()
	return c.scanArguments(value, force, consume)
}

func (c *storyboardStreamCall) replaceArguments(
	value string,
	consume storyboardCanvasNodeConsumer,
) error {
	current := string(c.arguments)
	switch {
	case value == current:
		return c.scanArguments("", true, consume)
	case strings.HasPrefix(value, current):
		return c.appendArguments(value[len(current):], true, consume)
	default:
		c.arguments = append(c.arguments[:0], value...)
		c.scanner = storyboardCanvasNodeScanner{}
		c.declaredCount, c.declaredCountSeen = 0, false
		c.captureDeclaredCount()
		return c.scanArguments(value, true, consume)
	}
}

func (c *storyboardStreamCall) captureDeclaredCount() {
	if c.declaredCountSeen {
		return
	}
	count, ok := storyboardDeclaredCount(c.arguments)
	if !ok {
		return
	}
	c.declaredCount, c.declaredCountSeen = count, true
}

func storyboardDeclaredCount(arguments []byte) (int, bool) {
	const field = `"planned_canvasnode_count"`
	root := bytes.TrimLeft(arguments, " \t\r\n")
	if len(root) == 0 || root[0] != '{' {
		return 0, false
	}
	root = bytes.TrimLeft(root[1:], " \t\r\n")
	if !bytes.HasPrefix(root, []byte(field)) {
		return 0, false
	}
	remaining := root[len(field):]
	colon := bytes.IndexByte(remaining, ':')
	if colon < 0 {
		return 0, false
	}
	remaining = bytes.TrimLeft(remaining[colon+1:], " \t\r\n")
	end := 0
	for end < len(remaining) && remaining[end] >= '0' && remaining[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0, false
	}
	count, err := strconv.Atoi(string(remaining[:end]))
	return count, err == nil
}

func (c *storyboardStreamCall) scanArguments(
	delta string,
	force bool,
	consume storyboardCanvasNodeConsumer,
) error {
	unscanned := len(c.arguments) - c.scanner.offset
	closingHint := strings.Contains(delta, "}")
	if !force && unscanned < progressiveScanStrideBytes && !closingHint {
		return nil
	}
	for _, raw := range c.scanner.scan(c.arguments) {
		fingerprint := fingerprintStoryboardArguments(raw)
		if _, exists := c.processed[fingerprint]; exists {
			continue
		}
		c.processed[fingerprint] = struct{}{}
		c.rawCanvasNodes++
		if c.extra {
			continue
		}
		result, err := consume(c.callID, c.rawCanvasNodes, raw)
		if err != nil {
			return err
		}
		if result.Rejection != "" {
			c.rejections = append(c.rejections, fmt.Sprintf(
				"canvas_nodes[%d] arguments=%s error=%s", c.rawCanvasNodes-1, raw, result.Rejection,
			))
			inputIndex := c.rawCanvasNodes - 1
			rejection := storyboardRepairRejection{
				InputIndex: &inputIndex, Rule: result.RejectionRule, Message: result.Rejection,
			}
			if result.AttemptedNumber > 0 {
				number := result.AttemptedNumber
				rejection.CanvasNodeNo = &number
			}
			c.repairRejections = append(c.repairRejections, rejection)
		}
	}
	trimmed := bytes.TrimSpace(c.arguments)
	c.argumentsComplete = c.scanner.arrayClosed && c.scanner.rootClosed &&
		c.scanner.canvasnodeDepth == 0 && json.Valid(trimmed)
	return nil
}

func fingerprintStoryboardArguments(value string) storyboardArgumentFingerprint {
	content := []byte(value)
	var decoded any
	if err := json.Unmarshal(content, &decoded); err == nil {
		if canonical, marshalErr := json.Marshal(decoded); marshalErr == nil {
			content = canonical
		}
	}
	var hash uint64 = 14695981039346656037
	for index := 0; index < len(content); index++ {
		hash ^= uint64(content[index])
		hash *= 1099511628211
	}
	return storyboardArgumentFingerprint{Size: len(content), Hash: hash}
}

type storyboardStreamOutcome struct {
	ResponseID string
	Calls      []*storyboardStreamCall
}

type storyboardModelError struct {
	message     string
	cause       error
	diagnostics []applicationcanvasnode.StoryboardRoundDiagnostic
}

func (e *storyboardModelError) Error() string {
	return e.message
}

func (e *storyboardModelError) Unwrap() error { return e.cause }

func (e *storyboardModelError) UserSafeMessage() string {
	return e.message
}

func (e *storyboardModelError) StoryboardDiagnostics() []applicationcanvasnode.StoryboardRoundDiagnostic {
	return append([]applicationcanvasnode.StoryboardRoundDiagnostic(nil), e.diagnostics...)
}

func newStoryboardModelError(format string, args ...any) error {
	return &storyboardModelError{message: fmt.Sprintf(format, args...)}
}

func newStoryboardCauseModelError(cause error, message string) error {
	return &storyboardModelError{message: message, cause: cause}
}

func newStoryboardTruncatedModelError(format string, args ...any) error {
	return &storyboardModelError{message: fmt.Sprintf(format, args...)}
}

func NewStoryboardSplitter(client platformaigwproxy.Client, log *zap.Logger) applicationcanvasnode.StoryboardSplitter {
	if log == nil {
		log = zap.NewNop()
	}
	return &StoryboardSplitter{client: client, log: log}
}

func (s *StoryboardSplitter) SplitWithState(
	ctx context.Context,
	taskRunID string,
	model applicationmodel.Selection,
	plot string,
	constraints applicationcanvasnode.StoryboardConstraints,
	state applicationcanvasnode.StoryboardGenerationState,
	modelCalls applicationcanvasnode.StoryboardModelCallLedger,
	checkpoint func(applicationcanvasnode.StoryboardGenerationState) error,
	emit func(applicationcanvasnode.StoryboardDraft) error,
) error {
	if checkpoint == nil {
		return errors.New("storyboard generation checkpoint is required")
	}
	if state.ProtocolVersion > applicationcanvasnode.StoryboardGenerationProtocolVersion {
		return errors.New("storyboard generation state is newer than this server")
	}
	return s.splitFrozenStoryboard(ctx, taskRunID, model, plot, constraints, state, modelCalls, checkpoint, emit)
}

func nextStoryboardModelCallOrdinal(
	ctx context.Context,
	taskRunID string,
	modelCalls applicationcanvasnode.StoryboardModelCallLedger,
) (int, error) {
	if modelCalls == nil {
		return 0, errors.New("storyboard model call ledger is required")
	}
	nextOrdinal, err := modelCalls.NextOrdinal(ctx, taskRunID)
	if err != nil {
		return 0, fmt.Errorf("load next storyboard model call ordinal: %w", err)
	}
	if nextOrdinal < 1 {
		return 0, fmt.Errorf("load next storyboard model call ordinal: invalid ordinal %d", nextOrdinal)
	}
	return nextOrdinal, nil
}

func (s *StoryboardSplitter) executeStoryboardRequest(
	ctx context.Context,
	taskRunID, modelID string,
	ordinal int,
	request *responses.ResponsesRequest,
	modelCalls applicationcanvasnode.StoryboardModelCallLedger,
	consume storyboardCanvasNodeConsumer,
) (storyboardStreamOutcome, error) {
	if err := ctx.Err(); err != nil {
		return storyboardStreamOutcome{}, err
	}
	call := applicationcanvasnode.StoryboardModelCall{
		TaskRunID: taskRunID, Ordinal: ordinal, ModelID: strings.TrimSpace(modelID),
	}
	if err := modelCalls.Begin(ctx, call); err != nil {
		return storyboardStreamOutcome{}, fmt.Errorf("begin storyboard model turn %d: %w", ordinal, err)
	}
	stream, err := s.client.CreateResponsesStream(ctx, request)
	call.RequestAttempted = platformaigwproxy.RequestAttempted(err)
	if stream != nil {
		call.RequestID = platformaigwproxy.AIGWRequestID(stream.Header())
	}
	if captureErr := modelCalls.Capture(context.WithoutCancel(ctx), call); captureErr != nil {
		if stream != nil {
			closeResponseStream(stream)
		}
		return storyboardStreamOutcome{}, fmt.Errorf("capture storyboard model turn %d: %w", ordinal, captureErr)
	}
	if err != nil {
		return storyboardStreamOutcome{}, newStoryboardCauseModelError(err, "inference model stream could not be created")
	}
	if consume == nil {
		consume = func(string, int, string) (storyboardCanvasNodeProcessResult, error) {
			return storyboardCanvasNodeProcessResult{}, nil
		}
	}
	outcome, consumeErr := consumeStoryboardResponseStream(stream, consume)
	closeResponseStream(stream)
	return outcome, consumeErr
}

func storyboardRoundDiagnostic(
	round int,
	responseID string,
	accepted, missing []int,
	rejections []storyboardRepairRejection,
) applicationcanvasnode.StoryboardRoundDiagnostic {
	if len(rejections) > storyboardMaxDiagnostics {
		rejections = rejections[:storyboardMaxDiagnostics]
	}
	diagnostic := applicationcanvasnode.StoryboardRoundDiagnostic{
		Round: round, ResponseID: strings.TrimSpace(responseID),
		AcceptedCanvasNodeNumber: append([]int(nil), accepted...),
		MissingCanvasNodeNumber:  append([]int(nil), missing...),
		Rejections:               make([]applicationcanvasnode.StoryboardRejectionDiagnostic, 0, len(rejections)),
	}
	for _, rejection := range rejections {
		diagnostic.Rejections = append(diagnostic.Rejections, applicationcanvasnode.StoryboardRejectionDiagnostic{
			CanvasNodeNo: rejection.CanvasNodeNo, InputIndex: rejection.InputIndex,
			Rule: strings.TrimSpace(rejection.Rule), Message: storyboardDiagnosticMessage(rejection.Rule),
		})
	}
	return diagnostic
}

func newStoryboardCauseDiagnosticModelError(
	cause error,
	diagnostics []applicationcanvasnode.StoryboardRoundDiagnostic,
	message string,
) error {
	return &storyboardModelError{
		message: message, cause: cause,
		diagnostics: append([]applicationcanvasnode.StoryboardRoundDiagnostic(nil), diagnostics...),
	}
}

func storyboardAcceptedNumbers(accepted map[int]struct{}) []int {
	numbers := make([]int, 0, len(accepted))
	for number := range accepted {
		numbers = append(numbers, number)
	}
	sort.Ints(numbers)
	return numbers
}

func plannedStoryboardRoundRejections(
	outcome storyboardStreamOutcome,
	plannedCount int,
	consumeErr error,
) []storyboardRepairRejection {
	rejections := make([]storyboardRepairRejection, 0)
	if len(outcome.Calls) == 0 {
		rejections = append(rejections, storyboardRepairRejection{
			Rule: "required_tool_call_missing", Message: "required create_canvas_nodes tool call was not returned",
		})
	}
	for index, call := range outcome.Calls {
		rejections = append(rejections, call.repairRejections...)
		if index > 0 {
			rejections = append(rejections, storyboardRepairRejection{
				Rule: "multiple_tool_calls", Message: "only one create_canvas_nodes tool call is allowed per model round",
			})
		}
		if call.name != storyboardToolName {
			rejections = append(rejections, storyboardRepairRejection{
				Rule: "unexpected_tool", Message: fmt.Sprintf("unexpected tool %q; expected %q", call.name, storyboardToolName),
			})
		}
		if !call.declaredCountSeen || call.declaredCount != plannedCount {
			rejections = append(rejections, storyboardRepairRejection{
				Rule: "planned_count_mismatch", Message: fmt.Sprintf("planned_canvasnode_count must equal %d", plannedCount),
			})
		}
		if !call.argumentsComplete {
			rejections = append(rejections, storyboardRepairRejection{
				Rule: "incomplete_tool_arguments", Message: "tool arguments are incomplete or are not a valid storyboard JSON object",
			})
		}
	}
	if consumeErr != nil {
		rejections = append(rejections, storyboardRepairRejection{
			Rule: "model_stream_incomplete", Message: consumeErr.Error(),
		})
	}
	return rejections
}

func storyboardPlannedRepairFeedback(
	plannedCount int,
	accepted map[int]struct{},
	missing []storyboardPlanItem,
	submitOnly []int,
	rejections []storyboardRepairRejection,
) string {
	payload, err := json.Marshal(storyboardRepairFeedback{
		Status: "repair_required", PlannedCanvasNodeCount: plannedCount,
		AcceptedCanvasNodeNumber: storyboardAcceptedNumbers(accepted),
		MissingCanvasNodeNumber:  storyboardPlanItemNumbers(missing),
		Rejections:               rejections,
		NextAction: &storyboardRepairNextAction{
			Tool: storyboardToolName, SubmitOnlyCanvasNodeNumber: append([]int(nil), submitOnly...),
		},
	})
	if err != nil {
		return `{"status":"repair_required"}`
	}
	return string(payload)
}

func (s *StoryboardSplitter) logPlannedModelRound(
	ctx context.Context,
	modelID string,
	round int,
	outcome storyboardStreamOutcome,
	accepted, missing []int,
	rejections []storyboardRepairRejection,
) {
	if s.log == nil {
		return
	}
	callIDs := make([]string, 0, len(outcome.Calls))
	for _, call := range outcome.Calls {
		callIDs = append(callIDs, call.callID)
	}
	reasons := make([]string, 0, len(rejections))
	for _, rejection := range rejections {
		reasons = append(reasons, rejection.Message)
	}
	fields := append(logcontext.Fields(ctx),
		zap.String("model_id", modelID), zap.Int("model_round", round),
		zap.String("response_id", outcome.ResponseID), zap.Strings("tool_call_ids", callIDs),
		zap.Ints("accepted_canvasnode_no", accepted), zap.Ints("missing_canvasnode_no", missing),
		zap.Strings("rejection_reasons", reasons),
	)
	s.log.Warn("planned storyboard model round requires correction", fields...)
}

func storyboardDiagnosticMessage(rule string) string {
	switch strings.TrimSpace(rule) {
	case "required_tool_call_missing":
		return "required create_canvas_nodes tool call was not returned"
	case "invalid_json", "incomplete_tool_arguments":
		return "tool arguments do not match the storyboard schema"
	case "planned_count_missing", "planned_count_out_of_range", "planned_count_mismatch":
		return "planned canvasnode count does not match the frozen storyboard plan"
	case "model_stream_incomplete":
		return "model stream ended before the storyboard envelope completed"
	case "multiple_tool_calls", "unexpected_tool", "canvasnode_count_out_of_range":
		return "tool call does not match the storyboard round contract"
	case "initial_number_mismatch", "out_of_plan_canvasnode_no", "already_accepted":
		return "canvasnode number does not match the storyboard repair state"
	case "duration_sum_mismatch", "duration_out_of_range":
		return "shot durations do not produce a valid canvasnode duration"
	case "source_text_omitted":
		return "shot scripts do not preserve required source dialogue or on-screen text exactly"
	case "invalid_asset_reference":
		return "canvasnode contains an invalid asset reference"
	default:
		return "canvasnode failed local storyboard validation"
	}
}

func closeResponseStream(stream platformaigwproxy.ResponsesStream) {
	if err := stream.Close(); err != nil {
		// A response-body cleanup failure cannot invalidate an already consumed
		// terminal event or emitted result.
		return
	}
}

func storyboardValidationRule(reason string) string {
	switch {
	case strings.HasPrefix(reason, "summary, global_setting"):
		return "required_content_missing"
	case strings.Contains(reason, "duration_seconds >= 1.5"):
		return "shot_content_invalid"
	case strings.Contains(reason, "shots duration sum"):
		return "duration_out_of_range"
	case strings.HasPrefix(reason, "asset_references"):
		return "invalid_asset_reference"
	default:
		return "validation_failed"
	}
}

func consumeStoryboardResponseStream(
	stream platformaigwproxy.ResponsesStream,
	consume storyboardCanvasNodeConsumer,
) (storyboardStreamOutcome, error) {
	if stream == nil || consume == nil {
		return storyboardStreamOutcome{}, errors.New("inference model returned no storyboard stream")
	}
	pending := make(map[string]*storyboardStreamCall)
	byCallID := make(map[string]*storyboardStreamCall)
	outcome := storyboardStreamOutcome{}
	register := func(itemID, callID, name string) (*storyboardStreamCall, error) {
		if strings.TrimSpace(callID) == "" {
			return nil, errors.New("model returned a tool call without call id")
		}
		if existing := byCallID[callID]; existing != nil {
			if itemID != "" {
				pending[itemID] = existing
			}
			return existing, nil
		}
		call := newStoryboardStreamCall(callID, name, len(outcome.Calls) > 0)
		byCallID[callID] = call
		outcome.Calls = append(outcome.Calls, call)
		if itemID != "" {
			pending[itemID] = call
		}
		return call, nil
	}
	finalize := func(call *storyboardStreamCall, arguments string) error {
		if call == nil {
			return nil
		}
		arguments = strings.TrimSpace(arguments)
		if arguments == "" {
			return call.scanArguments("", true, consume)
		}
		return call.replaceArguments(arguments, consume)
	}
	for {
		event, err := stream.Recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return outcome, errors.New("inference model stream ended before completion")
			}
			return outcome, err
		}
		if event == nil {
			continue
		}
		// response.created carries the stable response ID needed to submit tool
		// results in a correction round. Do not wait for response.completed after
		// the only tool call has finished producing its arguments: some gateways
		// keep that outer response open while waiting for a tool result.
		if created := event.GetResponse(); created != nil && created.GetResponse() != nil {
			outcome.ResponseID = created.GetResponse().GetId()
		}
		if inProgress := event.GetResponseInProgress(); inProgress != nil && inProgress.GetResponse() != nil &&
			strings.TrimSpace(outcome.ResponseID) == "" {
			outcome.ResponseID = inProgress.GetResponse().GetId()
		}
		if itemAdded := event.GetItem(); itemAdded != nil {
			toolCall := itemAdded.GetItem().GetFunctionToolCall()
			if toolCall != nil {
				call, registerErr := register(toolCall.GetId(), toolCall.GetCallId(), toolCall.GetName())
				if registerErr != nil {
					return storyboardStreamOutcome{}, registerErr
				}
				if err := call.appendArguments(toolCall.GetArguments(), true, consume); err != nil {
					return storyboardStreamOutcome{}, err
				}
			}
		}
		if argumentsDelta := event.GetFunctionCallArguments(); argumentsDelta != nil {
			if call := pending[argumentsDelta.GetItemId()]; call != nil {
				if err := call.appendArguments(argumentsDelta.GetDelta(), false, consume); err != nil {
					return storyboardStreamOutcome{}, err
				}
			}
		}
		if argumentsDone := event.GetFunctionCallArgumentsDone(); argumentsDone != nil {
			call := pending[argumentsDone.GetItemId()]
			if call == nil {
				return storyboardStreamOutcome{}, errors.New("model completed tool arguments for an unknown call")
			}
			if err := finalize(call, argumentsDone.GetArguments()); err != nil {
				return storyboardStreamOutcome{}, err
			}
			if call.argumentsComplete {
				return outcome, nil
			}
			// AIGW can emit arguments.done immediately before an outer
			// response.incomplete event when the model exhausts its output-token
			// budget. Keep reading so the terminal reason is not misclassified as
			// an invalid initial storyboard count.
			continue
		}
		if itemDone := event.GetItemDone(); itemDone != nil {
			toolCall := itemDone.GetItem().GetFunctionToolCall()
			if toolCall != nil {
				call, registerErr := register(toolCall.GetId(), toolCall.GetCallId(), toolCall.GetName())
				if registerErr != nil {
					return storyboardStreamOutcome{}, registerErr
				}
				if err := finalize(call, toolCall.GetArguments()); err != nil {
					return storyboardStreamOutcome{}, err
				}
			}
		}
		if streamError := event.GetError(); streamError != nil {
			return outcome, fmt.Errorf("inference model failed: %s", streamError.GetMessage())
		}
		var terminal *responses.ResponseObject
		switch {
		case event.GetResponseCompleted() != nil:
			terminal = event.GetResponseCompleted().GetResponse()
		case event.GetResponseFailed() != nil:
			terminal = event.GetResponseFailed().GetResponse()
		case event.GetResponseIncomplete() != nil:
			terminal = event.GetResponseIncomplete().GetResponse()
		default:
			continue
		}
		if terminal == nil {
			return outcome, errors.New("inference model returned no storyboard")
		}
		if responseError := terminal.GetError(); responseError != nil {
			return outcome, fmt.Errorf(
				"inference model failed: code=%q message=%q",
				responseError.GetCode(), responseError.GetMessage(),
			)
		}
		if terminal.GetStatus() != responses.ResponseStatus_completed {
			return outcome, storyboardTerminalError(terminal)
		}
		for _, item := range terminal.GetOutput() {
			toolCall := item.GetFunctionToolCall()
			if toolCall == nil {
				continue
			}
			call, registerErr := register(toolCall.GetId(), toolCall.GetCallId(), toolCall.GetName())
			if registerErr != nil {
				return storyboardStreamOutcome{}, registerErr
			}
			if err := finalize(call, toolCall.GetArguments()); err != nil {
				return storyboardStreamOutcome{}, err
			}
		}
		outcome.ResponseID = terminal.GetId()
		return outcome, nil
	}
}

func storyboardTerminalError(terminal *responses.ResponseObject) error {
	status := terminal.GetStatus().String()
	reason := strings.TrimSpace(terminal.GetIncompleteDetails().GetReason())
	usage := terminal.GetUsage()
	outputTokens := usage.GetOutputTokens()
	reasoningTokens := usage.GetOutputTokensDetails().GetReasoningTokens()
	toolCalls := 0
	for _, item := range terminal.GetOutput() {
		if item.GetFunctionToolCall() != nil {
			toolCalls++
		}
	}
	if reason == "length" {
		return newStoryboardTruncatedModelError(
			"inference model output was truncated before completing the required create_canvas_nodes tool call: "+
				"status=%s reason=%s output_tokens=%d reasoning_tokens=%d tool_calls=%d",
			status, reason, outputTokens, reasoningTokens, toolCalls,
		)
	}
	if reason != "" {
		return newStoryboardModelError(
			"inference model did not complete the required create_canvas_nodes tool call: "+
				"status=%s reason=%s output_tokens=%d reasoning_tokens=%d tool_calls=%d",
			status, reason, outputTokens, reasoningTokens, toolCalls,
		)
	}
	return newStoryboardModelError(
		"inference model did not complete the required create_canvas_nodes tool call: "+
			"status=%s output_tokens=%d reasoning_tokens=%d tool_calls=%d",
		status, outputTokens, reasoningTokens, toolCalls,
	)
}

func storyboardForcedToolRequest(
	model applicationmodel.Selection,
	schema []byte,
	toolName, description string,
	input []*responses.InputItem,
) *responses.ResponsesRequest {
	strict, parallelToolCalls, store := true, false, false
	request := &responses.ResponsesRequest{
		Model: model.ModelID, Store: &store,
		Tools: []*responses.ResponsesTool{{
			Union: &responses.ResponsesTool_ToolFunction{ToolFunction: &responses.ToolFunction{
				Name: toolName, Strict: &strict, Type: responses.ToolType_function,
				Description: &description, Parameters: &responses.Bytes{Value: schema},
			}},
		}},
		ToolChoice: &responses.ResponsesToolChoice{Union: &responses.ResponsesToolChoice_FunctionToolChoice{
			FunctionToolChoice: &responses.FunctionToolChoice{Type: responses.ToolType_function, Name: toolName},
		}},
		ParallelToolCalls: &parallelToolCalls,
		Reasoning:         &responses.ResponsesReasoning{Effort: responses.ReasoningEffort_minimal},
		Input: &responses.ResponsesInput{Union: &responses.ResponsesInput_ListValue{
			ListValue: &responses.InputItemList{ListValue: input},
		}},
	}
	request.Temperature = model.ModelConfig.Temperature
	request.TopP = model.ModelConfig.TopP
	request.MaxOutputTokens = model.ModelConfig.MaxTokens
	if effort, ok := storyboardReasoningEffort(model.ModelConfig.ReasoningEffortType); ok {
		request.Reasoning = &responses.ResponsesReasoning{Effort: effort}
	}
	return request
}

func storyboardReasoningEffort(value string) (responses.ReasoningEffort_Enum, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "minimal":
		return responses.ReasoningEffort_minimal, true
	case "low":
		return responses.ReasoningEffort_low, true
	case "medium":
		return responses.ReasoningEffort_medium, true
	case "high":
		return responses.ReasoningEffort_high, true
	default:
		return responses.ReasoningEffort_unspecified, false
	}
}

func splitStoryboardSourceBeats(
	plot string,
	constraints applicationcanvasnode.StoryboardConstraints,
) []storyboardSourceBeat {
	plot = strings.TrimSpace(plot)
	if plot == "" {
		return nil
	}
	_, maximumDuration := storyboardVideoDurationBounds(constraints)
	if maximumDuration < 1 {
		maximumDuration = 15
	}
	maximumUnits := maximumDuration * storyboardDurationUnitsPerSec
	sections := splitStoryboardPlotAtSceneHeadings(plot)
	beats := make([]storyboardSourceBeat, 0, len(sections))
	for _, section := range sections {
		beats = append(beats, splitStoryboardSectionBeats(section, maximumUnits)...)
	}
	return mergeStoryboardContextBeats(beats)
}

func splitStoryboardPlotAtSceneHeadings(plot string) []string {
	lines := strings.SplitAfter(plot, "\n")
	sections := make([]string, 0)
	var current strings.Builder
	for _, line := range lines {
		if _, isHeading := storyboardSceneHeading(strings.TrimSpace(line)); isHeading && current.Len() > 0 {
			sections = append(sections, current.String())
			current.Reset()
		}
		current.WriteString(line)
	}
	if current.Len() > 0 {
		sections = append(sections, current.String())
	}
	return sections
}

func splitStoryboardSectionBeats(section string, maximumUnits int) []storyboardSourceBeat {
	beats := make([]storyboardSourceBeat, 0)
	var current strings.Builder
	currentUnits := 0
	flush := func() {
		if text := strings.TrimSpace(current.String()); text != "" {
			beats = append(beats, storyboardSourceBeat{Text: text})
		}
		current.Reset()
		currentUnits = 0
	}
	for _, line := range strings.SplitAfter(section, "\n") {
		lineUnits := storyboardEstimatedDurationUnits(line)
		if lineUnits > maximumUnits {
			prefix := current.String()
			flush()
			chunks := splitStoryboardOversizedLine(line, maximumUnits)
			if len(chunks) > 0 && strings.TrimSpace(prefix) != "" {
				chunks[0].Text = strings.TrimSpace(prefix + chunks[0].Text)
			}
			beats = append(beats, chunks...)
			continue
		}
		if currentUnits > 0 && currentUnits+lineUnits > maximumUnits {
			flush()
		}
		current.WriteString(line)
		currentUnits += lineUnits
	}
	flush()
	return rebalanceStoryboardShortTail(beats, maximumUnits)
}

func rebalanceStoryboardShortTail(beats []storyboardSourceBeat, maximumUnits int) []storyboardSourceBeat {
	if len(beats) < 2 || maximumUnits < 2 ||
		storyboardEstimatedDurationUnits(beats[len(beats)-1].Text) >= maximumUnits/2 {
		return beats
	}
	leftIndex := len(beats) - 2
	combined := beats[leftIndex].Text + "\n" + beats[leftIndex+1].Text
	lines := strings.SplitAfter(combined, "\n")
	bestSplit, bestScore := -1, int(^uint(0)>>1)
	for split := 1; split < len(lines); split++ {
		left := strings.TrimSpace(strings.Join(lines[:split], ""))
		right := strings.TrimSpace(strings.Join(lines[split:], ""))
		if left == "" || right == "" {
			continue
		}
		leftUnits := storyboardEstimatedDurationUnits(left)
		rightUnits := storyboardEstimatedDurationUnits(right)
		if leftUnits == 0 || rightUnits == 0 || leftUnits > maximumUnits || rightUnits > maximumUnits {
			continue
		}
		score := leftUnits - rightUnits
		if score < 0 {
			score = -score
		}
		if leftUnits < maximumUnits/2 || rightUnits < maximumUnits/2 {
			score += maximumUnits
		}
		if score < bestScore {
			bestSplit, bestScore = split, score
		}
	}
	if bestSplit < 0 {
		return beats
	}
	beats[leftIndex].Text = strings.TrimSpace(strings.Join(lines[:bestSplit], ""))
	beats[leftIndex+1].Text = strings.TrimSpace(strings.Join(lines[bestSplit:], ""))
	return beats
}

func splitStoryboardOversizedLine(line string, maximumUnits int) []storyboardSourceBeat {
	runes := []rune(strings.TrimSpace(line))
	if len(runes) == 0 {
		return nil
	}
	continuationPrefix := storyboardDialogueContinuationPrefix(string(runes))
	beats := make([]storyboardSourceBeat, 0)
	for start := 0; start < len(runes); {
		prefix := ""
		if start > 0 {
			prefix = continuationPrefix
		}
		end := maximumStoryboardChunkEnd(runes, start, prefix, maximumUnits)
		if end < len(runes) {
			searchStart := start + max((end-start)/2, 1)
			if boundary := lastStoryboardBeatBoundary(runes, searchStart, end); boundary > start {
				end = boundary
			}
		}
		if text := strings.TrimSpace(string(runes[start:end])); text != "" {
			beats = append(beats, storyboardSourceBeat{Text: prefix + text})
		}
		start = end
	}
	return beats
}

func maximumStoryboardChunkEnd(runes []rune, start int, prefix string, maximumUnits int) int {
	low, high := start+1, len(runes)
	best := low
	for low <= high {
		middle := low + (high-low)/2
		text := prefix + string(runes[start:middle])
		if storyboardEstimatedDurationUnits(text) <= maximumUnits {
			best = middle
			low = middle + 1
			continue
		}
		high = middle - 1
	}
	return best
}

func storyboardDialogueContinuationPrefix(line string) string {
	if _, _, ok := storyboardScreenplayParts(line); !ok {
		return ""
	}
	if index := strings.Index(line, "："); index >= 0 {
		return strings.TrimSpace(line[:index]) + "："
	}
	if index := strings.Index(line, ":"); index >= 0 {
		return strings.TrimSpace(line[:index]) + ":"
	}
	return ""
}

func mergeStoryboardContextBeats(beats []storyboardSourceBeat) []storyboardSourceBeat {
	result := make([]storyboardSourceBeat, 0, len(beats))
	pendingContext := make([]string, 0)
	for _, beat := range beats {
		facts := parseStoryboardBeatFacts(beat.Text)
		if strings.TrimSpace(facts.PlayableText) == "" {
			pendingContext = append(pendingContext, strings.TrimSpace(beat.Text))
			continue
		}
		text := strings.TrimSpace(beat.Text)
		if len(pendingContext) > 0 {
			pendingContext = append(pendingContext, text)
			text = strings.Join(pendingContext, "\n")
			pendingContext = pendingContext[:0]
		}
		result = append(result, storyboardSourceBeat{Text: text})
	}
	if len(pendingContext) > 0 {
		text := strings.Join(pendingContext, "\n")
		if len(result) == 0 {
			result = append(result, storyboardSourceBeat{Text: text})
		} else {
			result[len(result)-1].Text += "\n" + text
		}
	}
	for index := range result {
		result[index].ID = fmt.Sprintf("beat-%03d", index+1)
	}
	return result
}

func lastStoryboardBeatBoundary(runes []rune, start, end int) int {
	for index := end - 1; index >= start; index-- {
		switch runes[index] {
		case '。', '！', '？', '；', '\n', '.', '!', '?', ';':
			return index + 1
		}
	}
	return end
}

func plannedStoryboardItem(items []storyboardPlanItem, number int) (storyboardPlanItem, bool) {
	for _, item := range items {
		if item.Number == number {
			return item, true
		}
	}
	return storyboardPlanItem{}, false
}

func missingStoryboardPlanItems(items []storyboardPlanItem, accepted map[int]struct{}) []storyboardPlanItem {
	missing := make([]storyboardPlanItem, 0, len(items))
	for _, item := range items {
		if _, exists := accepted[item.Number]; !exists {
			missing = append(missing, item)
		}
	}
	return missing
}

func storyboardPlanItemNumbers(items []storyboardPlanItem) []int {
	numbers := make([]int, 0, len(items))
	for _, item := range items {
		numbers = append(numbers, item.Number)
	}
	return numbers
}

func validPlannedDetailOutcome(outcome storyboardStreamOutcome, plannedCount int) bool {
	return len(outcome.Calls) == 1 && outcome.Calls[0].name == storyboardToolName &&
		outcome.Calls[0].argumentsComplete && outcome.Calls[0].declaredCountSeen &&
		outcome.Calls[0].declaredCount == plannedCount
}

func storyboardDurationRange(constraints applicationcanvasnode.StoryboardConstraints) string {
	if constraints.DurationMaxSeconds > 0 {
		return fmt.Sprintf("%d-%d 秒", constraints.DurationMinSeconds, constraints.DurationMaxSeconds)
	}
	return fmt.Sprintf("至少 %d 秒", constraints.DurationMinSeconds)
}

func storyboardTotalDurationRange(constraints applicationcanvasnode.StoryboardConstraints) string {
	if constraints.TotalDurationMinSeconds <= 0 && constraints.TotalDurationMaxSeconds <= 0 {
		return "未设置"
	}
	if constraints.TotalDurationMaxSeconds <= 0 {
		return fmt.Sprintf("至少 %d 秒", constraints.TotalDurationMinSeconds)
	}
	if constraints.TotalDurationMinSeconds <= 0 {
		return fmt.Sprintf("最多 %d 秒", constraints.TotalDurationMaxSeconds)
	}
	return fmt.Sprintf("%d-%d 秒", constraints.TotalDurationMinSeconds, constraints.TotalDurationMaxSeconds)
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}

func responseInputMessage(role responses.MessageRole_Enum, text string) *responses.InputItem {
	return &responses.InputItem{Union: &responses.InputItem_InputMessage{
		InputMessage: &responses.ItemInputMessage{
			Role: role,
			Content: []*responses.ContentItem{{Union: &responses.ContentItem_Text{
				Text: &responses.ContentItemText{Type: responses.ContentItemType_input_text, Text: text},
			}}},
		},
	}}
}
