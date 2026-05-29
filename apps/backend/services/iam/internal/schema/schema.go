package schema

import "time"

type AuthRequest struct {
	Account     string `json:"account"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl"`
	PhoneNumber string `json:"phoneNumber"`
	Locale      string `json:"locale"`
	Timezone    string `json:"timezone"`
}

type AccountAvailabilityResponse struct {
	Account   string `json:"account"`
	Available bool   `json:"available"`
}

type AuthResponse struct {
	AccessToken string       `json:"accessToken"`
	ExpiresAt   time.Time    `json:"expiresAt"`
	User        UserResponse `json:"user"`
}

type UserResponse struct {
	ID             string `json:"id"`
	Account        string `json:"account"`
	Email          string `json:"email"`
	DisplayName    string `json:"displayName"`
	AvatarURL      string `json:"avatarUrl"`
	Locale         string `json:"locale"`
	Timezone       string `json:"timezone"`
	Theme          string `json:"theme"`
	MarketingOptIn bool   `json:"marketingOptIn"`
	EmailVerified  bool   `json:"emailVerified"`
	// Type is the coarse identity class consumed by the frontend shell to gate
	// which apps/products are visible. Derived from role assignments:
	// holding an admin role ("super_admin"/"admin") => "admin", else "normal".
	Type string `json:"type"`
}

type RoleRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type AssignRoleRequest struct {
	RoleID string `json:"roleId"`
}

type RoleResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
}
