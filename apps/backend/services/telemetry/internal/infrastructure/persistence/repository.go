package persistence

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/example/monorepo/telemetry/internal/application"
	"github.com/example/monorepo/telemetry/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool        *pgxpool.Pool
	queries     *sqlc.Queries
	environment string
}

func Open(ctx context.Context, databaseURL, environment string) (*Repository, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open telemetry database: %w", err)
	}
	return &Repository{pool: pool, queries: sqlc.New(pool), environment: environment}, nil
}

func (repository *Repository) Close() { repository.pool.Close() }

func (repository *Repository) Ping(ctx context.Context) error { return repository.pool.Ping(ctx) }

func (repository *Repository) Ingest(ctx context.Context, batch application.RumBatch, auth application.AuthContext, now time.Time, records []application.EventRecord) error {
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin telemetry ingest: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	queries := repository.queries.WithTx(tx)
	performance := make([]sqlc.InsertPerformanceEventsParams, 0)
	errors := make([]sqlc.InsertErrorEventsParams, 0)
	warnings := make([]sqlc.InsertWarningEventsParams, 0)
	business := make([]sqlc.InsertBusinessEventsParams, 0)
	for _, record := range records {
		payload, marshalErr := json.Marshal(record.Payload)
		if marshalErr != nil {
			return fmt.Errorf("encode telemetry payload: %w", marshalErr)
		}
		serverTime := timestamp(now)
		clientTime := optionalTimestamp(record.TSClient)
		userID := optionalString(auth.UserID)
		username := optionalString(auth.Username)
		userAgent := firstNonEmpty(batch.UserAgent, auth.UserAgent)
		switch record.Type {
		case "perform":
			performance = append(performance, sqlc.InsertPerformanceEventsParams{
				TsServer: serverTime, TsClient: clientTime, App: batch.App, Env: repository.environment,
				Release: batch.Release, UserID: userID, Username: username, IsAdmin: boolInt(auth.IsAdmin()),
				DeviceID: batch.DeviceID, SessionID: batch.SessionID, TraceID: record.TraceID,
				Route: record.Route, UserAgent: userAgent, Metric: record.Metric, Value: record.Value, Payload: payload,
			})
		case "error":
			errors = append(errors, sqlc.InsertErrorEventsParams{
				TsServer: serverTime, TsClient: clientTime, App: batch.App, Env: repository.environment,
				Release: batch.Release, UserID: userID, Username: username, IsAdmin: boolInt(auth.IsAdmin()),
				DeviceID: batch.DeviceID, SessionID: batch.SessionID, TraceID: record.TraceID,
				Route: record.Route, UserAgent: userAgent, Fingerprint: record.Fingerprint, Name: record.Name,
				Message: &record.Message, Stack: &record.Stack, Payload: payload,
			})
		case "warning":
			warnings = append(warnings, sqlc.InsertWarningEventsParams{
				TsServer: serverTime, TsClient: clientTime, App: batch.App, Env: repository.environment,
				Release: batch.Release, UserID: userID, Username: username, IsAdmin: boolInt(auth.IsAdmin()),
				DeviceID: batch.DeviceID, SessionID: batch.SessionID, TraceID: record.TraceID,
				Route: record.Route, UserAgent: userAgent, Level: record.Level, Message: &record.Message, Payload: payload,
			})
		case "event":
			business = append(business, sqlc.InsertBusinessEventsParams{
				TsServer: serverTime, TsClient: clientTime, App: batch.App, Env: repository.environment,
				Release: batch.Release, UserID: userID, Username: username, IsAdmin: boolInt(auth.IsAdmin()),
				DeviceID: batch.DeviceID, SessionID: batch.SessionID, TraceID: record.TraceID,
				Route: record.Route, UserAgent: userAgent, Name: record.Name, Payload: payload,
			})
		}
	}
	if err := executeEventBatches(ctx, queries, performance, errors, warnings, business); err != nil {
		return err
	}

	last := batch.Events[len(batch.Events)-1]
	err = queries.UpsertSession(ctx, sqlc.UpsertSessionParams{
		App: batch.App, SessionID: batch.SessionID, TsServer: timestamp(now), Env: repository.environment,
		Release: batch.Release, UserID: optionalString(auth.UserID), Username: optionalString(auth.Username),
		IsAdmin: boolInt(auth.IsAdmin()), DeviceID: batch.DeviceID, Route: last.Route,
		UserAgent: firstNonEmpty(batch.UserAgent, auth.UserAgent), EventCount: int32(len(batch.Events)),
	})
	if err != nil {
		return fmt.Errorf("upsert telemetry session: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit telemetry ingest: %w", err)
	}
	return nil
}

func (repository *Repository) ListErrors(ctx context.Context, auth application.AuthContext, limit int) ([]application.ErrorEvent, error) {
	if auth.IsAdmin() {
		rows, err := repository.queries.ListErrors(ctx, int32(limit))
		if err != nil {
			return nil, fmt.Errorf("list telemetry errors: %w", err)
		}
		items := make([]application.ErrorEvent, len(rows))
		for index, row := range rows {
			items[index] = errorEvent(row.TsServer.Time, row.App, row.Release, row.UserID, row.Username, row.IsAdmin,
				row.DeviceID, row.SessionID, row.TraceID, row.Route, row.Fingerprint, row.Name, row.Message, row.Stack, row.Payload)
		}
		return items, nil
	}
	rows, err := repository.queries.ListErrorsByUser(ctx, sqlc.ListErrorsByUserParams{UserID: &auth.UserID, Limit: int32(limit)})
	if err != nil {
		return nil, fmt.Errorf("list telemetry errors: %w", err)
	}
	items := make([]application.ErrorEvent, len(rows))
	for index, row := range rows {
		items[index] = errorEvent(row.TsServer.Time, row.App, row.Release, row.UserID, row.Username, row.IsAdmin,
			row.DeviceID, row.SessionID, row.TraceID, row.Route, row.Fingerprint, row.Name, row.Message, row.Stack, row.Payload)
	}
	return items, nil
}

func (repository *Repository) ListPerformance(ctx context.Context, auth application.AuthContext, limit int) ([]application.PerformanceEvent, error) {
	if auth.IsAdmin() {
		rows, err := repository.queries.ListPerformance(ctx, int32(limit))
		if err != nil {
			return nil, fmt.Errorf("list telemetry performance: %w", err)
		}
		items := make([]application.PerformanceEvent, len(rows))
		for index, row := range rows {
			items[index] = performanceEvent(row.TsServer.Time, row.App, row.Release, row.UserID, row.Username,
				row.IsAdmin, row.DeviceID, row.SessionID, row.TraceID, row.Route, row.Metric, row.Value, row.Payload)
		}
		return items, nil
	}
	rows, err := repository.queries.ListPerformanceByUser(ctx, sqlc.ListPerformanceByUserParams{UserID: &auth.UserID, Limit: int32(limit)})
	if err != nil {
		return nil, fmt.Errorf("list telemetry performance: %w", err)
	}
	items := make([]application.PerformanceEvent, len(rows))
	for index, row := range rows {
		items[index] = performanceEvent(row.TsServer.Time, row.App, row.Release, row.UserID, row.Username,
			row.IsAdmin, row.DeviceID, row.SessionID, row.TraceID, row.Route, row.Metric, row.Value, row.Payload)
	}
	return items, nil
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func boolInt(value bool) int16 {
	if value {
		return 1
	}
	return 0
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func decodePayload(encoded []byte) map[string]any {
	value := map[string]any{}
	_ = json.Unmarshal(encoded, &value)
	return value
}

func timestamp(value time.Time) pgtype.Timestamp {
	return pgtype.Timestamp{Time: value, Valid: true}
}

func optionalTimestamp(value *time.Time) pgtype.Timestamp {
	if value == nil {
		return pgtype.Timestamp{}
	}
	return timestamp(*value)
}

func executeEventBatches(
	ctx context.Context,
	queries *sqlc.Queries,
	performance []sqlc.InsertPerformanceEventsParams,
	errors []sqlc.InsertErrorEventsParams,
	warnings []sqlc.InsertWarningEventsParams,
	business []sqlc.InsertBusinessEventsParams,
) error {
	var batchErr error
	record := func(_ int, err error) {
		if err != nil && batchErr == nil {
			batchErr = err
		}
	}
	if len(performance) > 0 {
		queries.InsertPerformanceEvents(ctx, performance).Exec(record)
	}
	if batchErr == nil && len(errors) > 0 {
		queries.InsertErrorEvents(ctx, errors).Exec(record)
	}
	if batchErr == nil && len(warnings) > 0 {
		queries.InsertWarningEvents(ctx, warnings).Exec(record)
	}
	if batchErr == nil && len(business) > 0 {
		queries.InsertBusinessEvents(ctx, business).Exec(record)
	}
	if batchErr != nil {
		return fmt.Errorf("insert telemetry events: %w", batchErr)
	}
	return nil
}

func errorEvent(
	ts time.Time,
	app, release string,
	userID, username *string,
	isAdmin int16,
	deviceID, sessionID string,
	traceID *string,
	route, fingerprint, name, message, stack string,
	payload []byte,
) application.ErrorEvent {
	return application.ErrorEvent{
		TSServer: ts, App: app, Release: release, UserID: userID, Username: username,
		IsAdmin: isAdmin != 0, DeviceID: deviceID, SessionID: sessionID, TraceID: traceID,
		Route: route, Fingerprint: fingerprint, Name: name, Message: message, Stack: stack,
		Payload: decodePayload(payload),
	}
}

func performanceEvent(
	ts time.Time,
	app, release string,
	userID, username *string,
	isAdmin int16,
	deviceID, sessionID string,
	traceID *string,
	route, metric string,
	value float64,
	payload []byte,
) application.PerformanceEvent {
	return application.PerformanceEvent{
		TSServer: ts, App: app, Release: release, UserID: userID, Username: username,
		IsAdmin: isAdmin != 0, DeviceID: deviceID, SessionID: sessionID, TraceID: traceID,
		Route: route, Metric: metric, Value: value, Payload: decodePayload(payload),
	}
}
