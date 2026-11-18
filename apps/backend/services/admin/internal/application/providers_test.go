package application

import "testing"

func TestValidateProviderRequiresArkForChat(t *testing.T) {
	t.Parallel()

	ark := "ark_responses"
	if err := validateProvider("chat", &ark, nil, 128_000, 8_192, false, true); err != nil {
		t.Fatalf("Ark chat provider rejected: %v", err)
	}

	for _, dialect := range []string{"openai_responses", "deepseek_responses"} {
		dialect := dialect
		t.Run(dialect, func(t *testing.T) {
			t.Parallel()
			if err := validateProvider("chat", &dialect, nil, 128_000, 8_192, false, true); err == nil {
				t.Fatalf("legacy dialect %q was accepted", dialect)
			}
		})
	}
}
