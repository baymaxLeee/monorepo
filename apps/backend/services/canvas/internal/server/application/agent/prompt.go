package agent

import (
	"crypto/sha256"
	"fmt"
)

const systemPrompt = "You are the AgentFrame creation assistant."

func currentAgentSpec(skillVersionIDs []string) AgentSpec {
	return AgentSpec{
		SkillVersionIDs: append([]string(nil), skillVersionIDs...),
		SystemPrompt:    systemPrompt,
		PromptVersion:   fmt.Sprintf("%x", sha256.Sum256([]byte(systemPrompt))),
	}
}
