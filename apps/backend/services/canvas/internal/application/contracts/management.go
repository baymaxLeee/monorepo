package contracts

type ProjectManagement struct {
	Project          Project  `json:"project"`
	Members          []Member `json:"members"`
	ProviderIDs      []string `json:"provider_ids"`
	UsageLimitMicros *int64   `json:"usage_limit_micros"`
	UsedAmountMicros int64    `json:"used_amount_micros"`
	Currency         string   `json:"currency"`
	CanManage        bool     `json:"can_manage"`
}
type UpdateProjectMembers struct {
	ExpectedRevision int64    `json:"expected_revision"`
	Members          []Member `json:"members"`
}
type UpdateProjectModels struct {
	ExpectedRevision int64    `json:"expected_revision"`
	ProviderIDs      []string `json:"provider_ids"`
}
type UpdateProjectUsageLimit struct {
	ExpectedRevision int64  `json:"expected_revision"`
	UsageLimitMicros *int64 `json:"usage_limit_micros"`
}
type ProjectProvider struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Model           string `json:"model"`
	ProviderKind    string `json:"provider_kind"`
	IsDefault       bool   `json:"is_default"`
	IsEnabled       bool   `json:"is_enabled"`
	Granted         bool   `json:"granted"`
	Currency        string `json:"currency"`
	UnitPriceMicros int64  `json:"unit_price_micros"`
}
type ProjectProviderList struct {
	Items []ProjectProvider `json:"items"`
}
type ProjectUsage struct {
	Total         int64  `json:"total"`
	Completed     int64  `json:"completed"`
	Failed        int64  `json:"failed"`
	Cancelled     int64  `json:"cancelled"`
	Active        int64  `json:"active"`
	BillingStatus string `json:"billing_status"`
}
