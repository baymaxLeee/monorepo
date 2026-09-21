package contracts

type StoryboardDraftInput struct {
	Parameters       *InferenceParameters `json:"parameters,omitempty"`
	OperationID      string               `json:"operation_id"`
	Plot             string               `json:"plot"`
	ProviderID       string               `json:"provider_id"`
	VideoConfig      GenerationConfig     `json:"video_config"`
	DurationMin      int32                `json:"duration_min"`
	DurationMax      int32                `json:"duration_max"`
	TotalDurationMin int32                `json:"total_duration_min"`
	TotalDurationMax int32                `json:"total_duration_max"`
}
type StoryboardShot struct {
	ID              string `json:"id"`
	SequenceNo      int32  `json:"sequence_no"`
	Prompt          string `json:"prompt"`
	DurationSeconds int32  `json:"duration_seconds"`
}
type StoryboardDraft struct {
	Revision        int64                `json:"revision"`
	Input           StoryboardDraftInput `json:"input"`
	CancelRequested bool                 `json:"cancel_requested"`
	ID              string               `json:"id"`
	Plot            string               `json:"plot"`
	Status          string               `json:"status"`
	Error           string               `json:"error"`
	VideoConfig     GenerationConfig     `json:"video_config"`
	Shots           []StoryboardShot     `json:"shots"`
	CreatedAt       string               `json:"created_at"`
}
type StoryboardDraftUpdate struct {
	ExpectedRevision int64            `json:"expected_revision"`
	Shots            []StoryboardShot `json:"shots"`
	VideoConfig      GenerationConfig `json:"video_config"`
}
type StoryboardProgress struct {
	Shots []StoryboardShot `json:"shots"`
}
type StoryboardDraftList struct {
	Items []StoryboardDraft `json:"items"`
}
type StoryboardConfirm struct {
	ExpectedRevision int64            `json:"expected_revision"`
	Shots            []StoryboardShot `json:"shots"`
	VideoConfig      GenerationConfig `json:"video_config"`
}
