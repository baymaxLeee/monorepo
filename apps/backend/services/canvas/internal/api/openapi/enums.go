package openapi

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	pathpkg "path"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
)

type enumDefinition struct {
	typeName     string
	description  string
	values       []int64
	names        []string
	descriptions []string
}

var (
	contractEnumsOnce sync.Once
	contractEnums     map[string]enumDefinition
	contractEnumsErr  error
)

// contractEnumSchema preserves the enum declarations that live in the Go
// contracts. Go reflection exposes a named integer's type, but not its declared
// constants, so the OpenAPI-only exporter reads those declarations from the
// local source tree. This keeps the Go constants as the single source of truth
// and avoids a second hand-maintained enum registry.
func contractEnumSchema(value reflect.Type, schemas map[string]any) (map[string]any, bool) {
	if value.Name() == "" || !strings.Contains(value.PkgPath(), "/internal/api/contracts/") {
		return nil, false
	}

	contractEnumsOnce.Do(func() {
		contractEnums, contractEnumsErr = loadContractEnums()
	})
	if contractEnumsErr != nil {
		panic(contractEnumsErr)
	}

	definition, exists := contractEnums[pathpkg.Base(value.PkgPath())+"."+value.Name()]
	if !exists {
		panic(fmt.Sprintf("named integer contract %s.%s has no explicit enum constants", value.PkgPath(), value.Name()))
	}

	stringNames := make([]string, 0, len(definition.values))
	for _, enumValue := range definition.values {
		item := reflect.New(value).Elem()
		if value.Kind() >= reflect.Uint && value.Kind() <= reflect.Uint64 {
			item.SetUint(uint64(enumValue))
		} else {
			item.SetInt(enumValue)
		}
		stringer, ok := item.Interface().(fmt.Stringer)
		if !ok {
			panic(fmt.Sprintf("enum contract %s.%s must implement fmt.Stringer", value.PkgPath(), value.Name()))
		}
		name := stringer.String()
		if name == "" || name == "<UNSET>" {
			panic(fmt.Sprintf("enum contract %s.%s has no name for value %d", value.PkgPath(), value.Name(), enumValue))
		}
		stringNames = append(stringNames, name)
	}
	if !slices.Equal(definition.names, stringNames) {
		panic(fmt.Sprintf("enum contract %s.%s constant names do not match String values", value.PkgPath(), value.Name()))
	}

	name := canvasSchemaName(value.Name())
	addEnumSchema(schemas, name, definition)
	return map[string]any{"$ref": "#/components/schemas/" + name}, true
}

func addAllContractEnumSchemas(schemas map[string]any) {
	contractEnumsOnce.Do(func() {
		contractEnums, contractEnumsErr = loadContractEnums()
	})
	if contractEnumsErr != nil {
		panic(contractEnumsErr)
	}
	for _, definition := range contractEnums {
		addEnumSchema(schemas, canvasSchemaName(definition.typeName), definition)
	}
}

func addEnumSchema(schemas map[string]any, name string, definition enumDefinition) {
	schema := map[string]any{
		"type":                "integer",
		"format":              "int64",
		"enum":                definition.values,
		"x-enumNames":         definition.names,
		"x-enum-varnames":     definition.names,
		"x-enum-descriptions": definition.descriptions,
	}
	if definition.description != "" {
		schema["description"] = definition.description
	}
	if existing, exists := schemas[name]; exists {
		if !reflect.DeepEqual(existing, schema) {
			panic(fmt.Sprintf("conflicting Canvas OpenAPI schema %s", name))
		}
		return
	}
	schemas[name] = schema
}

func loadContractEnums() (map[string]enumDefinition, error) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return nil, fmt.Errorf("locate Canvas OpenAPI enum exporter")
	}
	contractsRoot := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "contracts"))
	definitions := map[string]enumDefinition{}

	err := filepath.WalkDir(contractsRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ParseComments)
		if err != nil {
			return fmt.Errorf("parse contract enums from %s: %w", path, err)
		}

		typeDescriptions := map[string]string{}
		for _, declaration := range file.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.TYPE {
				continue
			}
			for _, rawSpec := range general.Specs {
				typeSpec, ok := rawSpec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				identifier, ok := typeSpec.Type.(*ast.Ident)
				if !ok || !strings.HasPrefix(identifier.Name, "int") {
					continue
				}
				doc := typeSpec.Doc
				if doc == nil {
					doc = general.Doc
				}
				typeDescriptions[typeSpec.Name.Name] = commentText(doc)
			}
		}

		for _, declaration := range file.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.CONST {
				continue
			}
			for _, rawSpec := range general.Specs {
				valueSpec, ok := rawSpec.(*ast.ValueSpec)
				if !ok || len(valueSpec.Names) != 1 || len(valueSpec.Values) != 1 {
					continue
				}
				typeName, ok := valueSpec.Type.(*ast.Ident)
				if !ok {
					continue
				}
				typeDescription, isEnum := typeDescriptions[typeName.Name]
				if !isEnum {
					continue
				}
				value, err := integerLiteral(valueSpec.Values[0])
				if err != nil {
					return fmt.Errorf("%s: enum %s constant %s: %w", path, typeName.Name, valueSpec.Names[0].Name, err)
				}
				key := file.Name.Name + "." + typeName.Name
				definition := definitions[key]
				definition.typeName = typeName.Name
				definition.description = typeDescription
				definition.values = append(definition.values, value)
				constantName := strings.TrimPrefix(valueSpec.Names[0].Name, typeName.Name+"_")
				if constantName == valueSpec.Names[0].Name {
					return fmt.Errorf("%s: enum constant %s must start with %s_", path, constantName, typeName.Name)
				}
				definition.names = append(definition.names, constantName)
				description := commentText(valueSpec.Doc)
				if description == "" {
					description = commentText(valueSpec.Comment)
				}
				definition.descriptions = append(definition.descriptions, description)
				definitions[key] = definition
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("load Canvas contract enums: %w", err)
	}
	return definitions, nil
}

func integerLiteral(expression ast.Expr) (int64, error) {
	sign := int64(1)
	if unary, ok := expression.(*ast.UnaryExpr); ok {
		if unary.Op == token.SUB {
			sign = -1
		} else if unary.Op != token.ADD {
			return 0, fmt.Errorf("unsupported unary operator %s", unary.Op)
		}
		expression = unary.X
	}
	literal, ok := expression.(*ast.BasicLit)
	if !ok || literal.Kind != token.INT {
		return 0, fmt.Errorf("value must be an explicit integer literal")
	}
	value, err := strconv.ParseInt(literal.Value, 0, 64)
	if err != nil {
		return 0, err
	}
	return sign * value, nil
}

func commentText(group *ast.CommentGroup) string {
	if group == nil {
		return ""
	}
	return strings.TrimSpace(group.Text())
}
