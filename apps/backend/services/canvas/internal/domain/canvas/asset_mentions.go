package canvas

import (
	"errors"
	"fmt"
	stdhtml "html"
	"io"
	"strings"

	"golang.org/x/net/html"
)

// AssetMentionIDs derives the ordered, unique Asset references from the
// persisted prompt. The browser may do the same work for immediate UI feedback,
// but the server never trusts a client-supplied reference list.
func AssetMentionIDs(prompt string) ([]string, error) {
	ids := make([]string, 0)
	seen := make(map[string]struct{})
	err := walkAssetMentions(prompt, func(id, _ string) (string, error) {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
		return "", nil
	}, nil)
	return ids, err
}

// ReplaceAssetMentionIDs rewrites mention data-id values in place and leaves
// unrelated prompt text and mention labels unchanged.
func ReplaceAssetMentionIDs(prompt string, ids map[string]string) (string, error) {
	if len(ids) == 0 {
		return prompt, nil
	}
	tokenizer := html.NewTokenizer(strings.NewReader(prompt))
	var rewritten strings.Builder
	for {
		tokenType := tokenizer.Next()
		if tokenType == html.ErrorToken {
			if errors.Is(tokenizer.Err(), io.EOF) {
				return rewritten.String(), nil
			}
			return "", tokenizer.Err()
		}
		raw := string(tokenizer.Raw())
		if tokenType == html.StartTagToken || tokenType == html.SelfClosingTagToken {
			token := tokenizer.Token()
			if token.Data == "span" {
				id, mention := mentionID(token)
				if mention {
					if next, ok := ids[id]; ok && strings.TrimSpace(next) != "" && next != id {
						raw = rewriteMentionDataID(raw, id, next)
					}
				}
			}
		}
		rewritten.WriteString(raw)
	}
}

func rewriteMentionDataID(raw, from, to string) string {
	encodedTo := stdhtml.EscapeString(to)
	for _, old := range []string{from, stdhtml.EscapeString(from)} {
		needle := `data-id="` + old + `"`
		if strings.Contains(raw, needle) {
			return strings.Replace(raw, needle, `data-id="`+encodedTo+`"`, 1)
		}
	}
	return raw
}

// RewriteAssetMentions replaces mention spans without normalizing unrelated
// prompt text. Repeated mentions are resolved independently by the caller.
func RewriteAssetMentions(
	prompt string,
	resolve func(string) (string, error),
) (string, error) {
	return RewriteAssetMentionsWithLabel(prompt, func(id, _ string) (string, error) {
		return resolve(id)
	})
}

// RewriteAssetMentionsWithLabel replaces mention spans while exposing the
// persisted display label to callers that need to keep references readable.
func RewriteAssetMentionsWithLabel(
	prompt string,
	resolve func(string, string) (string, error),
) (string, error) {
	var rewritten strings.Builder
	err := walkAssetMentions(prompt, resolve, &rewritten)
	if err != nil {
		return "", err
	}
	return rewritten.String(), nil
}

// ReplaceAssetMentionsWithLabels removes mention markup while preserving the
// user-visible label. First/last-frame mode does not consume all-in-one prompt
// references, but the surrounding prompt text must remain readable.
func ReplaceAssetMentionsWithLabels(prompt string) (string, error) {
	tokenizer := html.NewTokenizer(strings.NewReader(prompt))
	var rewritten strings.Builder
	skipMentionDepth := 0
	for {
		tokenType := tokenizer.Next()
		if tokenType == html.ErrorToken {
			if errors.Is(tokenizer.Err(), io.EOF) {
				return rewritten.String(), nil
			}
			return "", tokenizer.Err()
		}
		raw := string(tokenizer.Raw())
		token := tokenizer.Token()
		if skipMentionDepth > 0 {
			switch tokenType {
			case html.StartTagToken:
				skipMentionDepth++
			case html.EndTagToken:
				skipMentionDepth--
			}
			continue
		}
		if (tokenType == html.StartTagToken || tokenType == html.SelfClosingTagToken) && token.Data == "span" {
			if _, mention := mentionID(token); mention {
				for _, attribute := range token.Attr {
					if attribute.Key == "data-label" {
						rewritten.WriteString(attribute.Val)
						break
					}
				}
				if tokenType == html.StartTagToken {
					skipMentionDepth = 1
				}
				continue
			}
		}
		rewritten.WriteString(raw)
	}
}

// walkAssetMentions tokenizes an HTML/Markdown fragment without normalizing
// unrelated text. Mention spans are the only tokens interpreted by the server.
// If output is nil it only validates/collects IDs.
func walkAssetMentions(prompt string, resolve func(string, string) (string, error), output *strings.Builder) error {
	tokenizer := html.NewTokenizer(strings.NewReader(prompt))
	skipMentionDepth := 0
	for {
		tokenType := tokenizer.Next()
		if tokenType == html.ErrorToken {
			if errors.Is(tokenizer.Err(), io.EOF) {
				return nil
			}
			return tokenizer.Err()
		}
		raw := string(tokenizer.Raw())
		token := tokenizer.Token()
		if skipMentionDepth > 0 {
			switch tokenType {
			case html.StartTagToken:
				skipMentionDepth++
			case html.EndTagToken:
				skipMentionDepth--
			}
			continue
		}
		if (tokenType == html.StartTagToken || tokenType == html.SelfClosingTagToken) && token.Data == "span" {
			id, mention := mentionID(token)
			if mention {
				replacement, err := resolve(id, mentionLabel(token))
				if err != nil {
					return err
				}
				if output != nil {
					output.WriteString(replacement)
				}
				if tokenType == html.StartTagToken {
					skipMentionDepth = 1
				}
				continue
			}
		}
		if output != nil {
			output.WriteString(raw)
		}
	}
}

func mentionLabel(token html.Token) string {
	for _, attribute := range token.Attr {
		if attribute.Key == "data-label" {
			return attribute.Val
		}
	}
	return ""
}

// FormatAssetMention serializes a Prompt mention in the same HTML shape the
// editor persists. Empty IDs are omitted so callers cannot write unparsable tags.
func FormatAssetMention(id, label string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return ""
	}
	return fmt.Sprintf(
		`<span data-type="mention" data-id="%s" data-label="%s"></span>`,
		stdhtml.EscapeString(id),
		stdhtml.EscapeString(label),
	)
}

func mentionID(token html.Token) (string, bool) {
	var id string
	mention := false
	for _, attribute := range token.Attr {
		switch attribute.Key {
		case "data-type":
			mention = attribute.Val == "mention"
		case "data-id":
			id = strings.TrimSpace(attribute.Val)
		}
	}
	return id, mention && id != ""
}

// InsertAssetMentionAfterText only touches literal text outside existing spans;
// asset labels and HTML attributes must never become insertion anchors.
func InsertAssetMentionAfterText(prompt, anchor, id, label string) (string, bool, error) {
	if strings.TrimSpace(anchor) == "" || strings.TrimSpace(id) == "" {
		return prompt, false, nil
	}
	ids, err := AssetMentionIDs(prompt)
	if err != nil {
		return "", false, err
	}
	for _, existing := range ids {
		if existing == strings.TrimSpace(id) {
			return prompt, false, nil
		}
	}
	tokenizer := html.NewTokenizer(strings.NewReader(prompt))
	var result strings.Builder
	depth := 0
	inserted := false
	for {
		kind := tokenizer.Next()
		if kind == html.ErrorToken {
			if errors.Is(tokenizer.Err(), io.EOF) {
				return result.String(), inserted, nil
			}
			return "", false, tokenizer.Err()
		}
		raw := string(tokenizer.Raw())
		if kind == html.StartTagToken {
			token := tokenizer.Token()
			if token.Data == "span" {
				depth++
			}
		} else if kind == html.EndTagToken {
			if tokenizer.Token().Data == "span" && depth > 0 {
				depth--
			}
		} else if kind == html.TextToken && depth == 0 && !inserted {
			if index := strings.Index(raw, anchor); index >= 0 {
				end := index + len(anchor)
				raw = raw[:end] + FormatAssetMention(id, label) + raw[end:]
				inserted = true
			}
		}
		result.WriteString(raw)
	}
}
