package canvasnode

import "context"

func (j *EventJournal) Register() {
	j.db.SetProjectionFlush(j.flush)
}

func (j *EventJournal) flush(ctx context.Context) error {
	scopes, err := j.db.Queries(ctx).ChangedCanvasScopes(ctx)
	if err != nil {
		return err
	}
	for _, scope := range scopes {
		if err := j.record(ctx, eventScope(scope)); err != nil {
			return err
		}
	}
	return nil
}
