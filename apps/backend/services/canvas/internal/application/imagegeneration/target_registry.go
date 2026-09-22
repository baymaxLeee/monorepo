package imagegeneration

import (
	"reflect"

	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
)

type TargetRegistry struct {
	handlers map[domainimagegeneration.TargetType]TargetHandler
}

func NewTargetRegistry(handlers ...TargetHandler) (*TargetRegistry, error) {
	registry := &TargetRegistry{handlers: make(map[domainimagegeneration.TargetType]TargetHandler, len(handlers))}
	for _, handler := range handlers {
		if nilTargetHandler(handler) || !handler.TargetType().Valid() {
			return nil, ErrTargetHandlerNotFound
		}
		if _, duplicate := registry.handlers[handler.TargetType()]; duplicate {
			return nil, ErrDuplicateTargetHandler
		}
		registry.handlers[handler.TargetType()] = handler
	}
	return registry, nil
}

func (registry *TargetRegistry) Handler(targetType domainimagegeneration.TargetType) (TargetHandler, error) {
	if registry == nil || !targetType.Valid() {
		return nil, ErrTargetHandlerNotFound
	}
	handler, exists := registry.handlers[targetType]
	if !exists || nilTargetHandler(handler) {
		return nil, ErrTargetHandlerNotFound
	}
	return handler, nil
}

func nilTargetHandler(handler TargetHandler) bool {
	if handler == nil {
		return true
	}
	value := reflect.ValueOf(handler)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return value.IsNil()
	default:
		return false
	}
}
