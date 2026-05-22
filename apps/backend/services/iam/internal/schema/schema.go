package schema

import "time"

type AuthRequest struct {
	Account     string `json:"account"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	Locale      string `json:"locale"`
	Timezone    string `json:"timezone"`
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
