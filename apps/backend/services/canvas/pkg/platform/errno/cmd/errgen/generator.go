package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"go/format"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"text/template"
)

const defaultUnknownBizCode int32 = 5000000

var codePattern = regexp.MustCompile(`^[A-Z][A-Za-z0-9]*$`)

//go:embed errors.tmpl
var fileTemplate string

type ErrorSpec struct {
	Code     string `json:"Code"`
	BizCode  int32  `json:"BizCode"`
	HTTPCode int    `json:"HTTPCode"`
	Message  string `json:"Message"`
	Comment  string `json:"Comment"`
}

type loadedSpec struct {
	ErrorSpec
	Source string
	Index  int
}

type templateData struct {
	Package string
	Items   []ErrorSpec
}

type config struct {
	inputFile string
	inputDir  string
	output    string
	pkg       string
}

func run(args []string) error {
	cfg, err := parseFlags(args)
	if err != nil {
		return err
	}
	specs, err := loadSpecs(cfg.inputFile, cfg.inputDir)
	if err != nil {
		return err
	}
	normalized, err := normalizeSpecs(specs)
	if err != nil {
		return err
	}
	output, err := renderGoFile(cfg.pkg, normalized)
	if err != nil {
		return err
	}
	if err := os.WriteFile(cfg.output, output, 0o644); err != nil {
		return fmt.Errorf("write output %s: %w", cfg.output, err)
	}
	return nil
}

func parseFlags(args []string) (config, error) {
	flags := flag.NewFlagSet("errgen", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)

	var cfg config
	flags.StringVar(&cfg.inputFile, "in", "", "input JSON file")
	flags.StringVar(&cfg.inputDir, "dir", "", "input JSON directory")
	flags.StringVar(&cfg.output, "out", "", "output Go file")
	flags.StringVar(&cfg.pkg, "pkg", "errno", "generated package name")
	if err := flags.Parse(args); err != nil {
		return config{}, err
	}
	if strings.TrimSpace(cfg.output) == "" {
		return config{}, errors.New("-out is required")
	}
	if (cfg.inputFile == "") == (cfg.inputDir == "") {
		return config{}, errors.New("exactly one of -in or -dir is required")
	}
	return cfg, nil
}

func loadSpecs(inputFile, inputDir string) ([]loadedSpec, error) {
	if inputFile != "" {
		return loadFromFile(inputFile)
	}
	return loadFromDir(inputDir)
}

func loadFromFile(path string) ([]loadedSpec, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var specs []ErrorSpec
	if err := json.Unmarshal(raw, &specs); err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	if len(specs) == 0 {
		return nil, fmt.Errorf("no error specs found in %s", path)
	}
	items := make([]loadedSpec, 0, len(specs))
	for index, spec := range specs {
		items = append(items, loadedSpec{
			ErrorSpec: spec,
			Source:    path,
			Index:     index,
		})
	}
	return items, nil
}

func loadFromDir(dir string) ([]loadedSpec, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, fmt.Errorf("list error specs in %s: %w", dir, err)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no JSON files found in %s", dir)
	}
	slices.Sort(files)
	var items []loadedSpec
	for _, file := range files {
		specs, err := loadFromFile(file)
		if err != nil {
			return nil, err
		}
		items = append(items, specs...)
	}
	return items, nil
}

func normalizeSpecs(specs []loadedSpec) ([]ErrorSpec, error) {
	if len(specs) == 0 {
		return nil, errors.New("no error specs loaded")
	}
	seenCode := make(map[string]loadedSpec, len(specs))
	seenBizCode := make(map[int32]loadedSpec, len(specs))
	normalized := make([]ErrorSpec, 0, len(specs))

	for _, item := range specs {
		spec, err := validateSpec(item)
		if err != nil {
			return nil, err
		}
		if previous, exists := seenCode[spec.Code]; exists {
			return nil, fmt.Errorf(
				"duplicate Code %q at %s[%d], already defined at %s[%d]",
				spec.Code,
				item.Source,
				item.Index,
				previous.Source,
				previous.Index,
			)
		}
		if previous, exists := seenBizCode[spec.BizCode]; exists {
			return nil, fmt.Errorf(
				"duplicate BizCode %d at %s[%d], already defined at %s[%d]",
				spec.BizCode,
				item.Source,
				item.Index,
				previous.Source,
				previous.Index,
			)
		}
		seenCode[spec.Code] = item
		seenBizCode[spec.BizCode] = item
		normalized = append(normalized, spec)
	}
	if _, exists := seenCode["InternalError"]; !exists {
		return nil, errors.New(`required error Code "InternalError" is missing`)
	}
	sort.Slice(normalized, func(i, j int) bool {
		if normalized[i].BizCode == normalized[j].BizCode {
			return normalized[i].Code < normalized[j].Code
		}
		return normalized[i].BizCode < normalized[j].BizCode
	})
	return normalized, nil
}

func validateSpec(item loadedSpec) (ErrorSpec, error) {
	spec := item.ErrorSpec
	spec.Code = strings.TrimSpace(spec.Code)
	spec.Message = strings.TrimSpace(spec.Message)
	spec.Comment = strings.TrimSpace(spec.Comment)
	location := fmt.Sprintf("%s[%d]", item.Source, item.Index)

	switch {
	case !codePattern.MatchString(spec.Code):
		return ErrorSpec{}, fmt.Errorf(
			"%s: Code %q must match %s",
			location,
			spec.Code,
			codePattern.String(),
		)
	case spec.BizCode <= 0:
		return ErrorSpec{}, fmt.Errorf("%s: BizCode must be positive", location)
	case spec.HTTPCode < 100 || spec.HTTPCode > 599:
		return ErrorSpec{}, fmt.Errorf(
			"%s: HTTPCode %d is invalid",
			location,
			spec.HTTPCode,
		)
	case spec.Message == "":
		return ErrorSpec{}, fmt.Errorf("%s: Message cannot be empty", location)
	case spec.Comment == "":
		return ErrorSpec{}, fmt.Errorf("%s: Comment cannot be empty", location)
	}
	return spec, nil
}

func renderGoFile(pkg string, specs []ErrorSpec) ([]byte, error) {
	tmpl := template.Must(template.New("errno").Funcs(template.FuncMap{
		"ToConst": func(code string) string { return "Err" + code },
	}).Parse(strings.ReplaceAll(
		fileTemplate,
		"__UNKNOWN_BIZ_CODE__",
		fmt.Sprintf("%d", defaultUnknownBizCode),
	)))
	var output bytes.Buffer
	if err := tmpl.Execute(&output, templateData{
		Package: pkg,
		Items:   specs,
	}); err != nil {
		return nil, fmt.Errorf("render generated file: %w", err)
	}
	formatted, err := format.Source(output.Bytes())
	if err != nil {
		return nil, fmt.Errorf("format generated file: %w", err)
	}
	return formatted, nil
}
