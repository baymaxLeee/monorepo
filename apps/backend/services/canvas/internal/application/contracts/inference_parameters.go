package contracts

type InferenceParameters struct {
	Temperature     *float64 `json:"temperature,omitempty"`
	TopP            *float64 `json:"topP,omitempty"`
	MaxOutputTokens *int64   `json:"maxOutputTokens,omitempty"`
	ReasoningEffort *string  `json:"reasoningEffort,omitempty"`
}
