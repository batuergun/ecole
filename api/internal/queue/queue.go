package queue

import (
	"context"
	"encoding/json"
	"time"

	"github.com/batuhanergun/ecole/api/internal/model"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Queue struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Queue {
	return &Queue{pool: pool}
}

func (q *Queue) Enqueue(ctx context.Context, jobType, projectID string, payload json.RawMessage) (*model.Job, error) {
	if payload == nil {
		payload = json.RawMessage(`{}`)
	}
	var j model.Job
	err := q.pool.QueryRow(ctx, `
		INSERT INTO jobs (job_type, project_id, payload)
		VALUES ($1, $2, $3)
		RETURNING id, job_type, project_id, payload, status, worker_id, attempts, max_attempts, error, created_at, claimed_at, completed_at
	`, jobType, projectID, payload).Scan(
		&j.ID, &j.JobType, &j.ProjectID, &j.Payload, &j.Status,
		&j.WorkerID, &j.Attempts, &j.MaxAttempts, &j.Error,
		&j.CreatedAt, &j.ClaimedAt, &j.CompletedAt,
	)
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func (q *Queue) Claim(ctx context.Context, workerID string) (*model.Job, error) {
	var j model.Job
	err := q.pool.QueryRow(ctx, `
		UPDATE jobs SET status = 'claimed', worker_id = $1, claimed_at = NOW(), attempts = attempts + 1
		WHERE id = (
			SELECT id FROM jobs
			WHERE status = 'pending' AND attempts < max_attempts
			ORDER BY created_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING id, job_type, project_id, payload, status, worker_id, attempts, max_attempts, error, created_at, claimed_at, completed_at
	`, workerID).Scan(
		&j.ID, &j.JobType, &j.ProjectID, &j.Payload, &j.Status,
		&j.WorkerID, &j.Attempts, &j.MaxAttempts, &j.Error,
		&j.CreatedAt, &j.ClaimedAt, &j.CompletedAt,
	)
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func (q *Queue) UpdateProgress(ctx context.Context, jobID, status string) error {
	_, err := q.pool.Exec(ctx, `UPDATE jobs SET status = $2 WHERE id = $1`, jobID, status)
	return err
}

func (q *Queue) Complete(ctx context.Context, jobID string) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE jobs SET status = 'completed', completed_at = NOW() WHERE id = $1
	`, jobID)
	return err
}

func (q *Queue) Fail(ctx context.Context, jobID, errMsg string) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE jobs SET status = 'failed', error = $2, completed_at = NOW() WHERE id = $1
	`, jobID, errMsg)
	return err
}

func (q *Queue) GetJob(ctx context.Context, jobID string) (*model.Job, error) {
	var j model.Job
	err := q.pool.QueryRow(ctx, `
		SELECT id, job_type, project_id, payload, status, worker_id, attempts, max_attempts, error, created_at, claimed_at, completed_at
		FROM jobs WHERE id = $1
	`, jobID).Scan(
		&j.ID, &j.JobType, &j.ProjectID, &j.Payload, &j.Status,
		&j.WorkerID, &j.Attempts, &j.MaxAttempts, &j.Error,
		&j.CreatedAt, &j.ClaimedAt, &j.CompletedAt,
	)
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func (q *Queue) GetLatestJobByType(ctx context.Context, projectID, jobType string) (*model.Job, error) {
	var j model.Job
	err := q.pool.QueryRow(ctx, `
		SELECT id, job_type, project_id, payload, status, worker_id, attempts, max_attempts, error, created_at, claimed_at, completed_at
		FROM jobs WHERE project_id = $1 AND job_type = $2
		ORDER BY created_at DESC LIMIT 1
	`, projectID, jobType).Scan(
		&j.ID, &j.JobType, &j.ProjectID, &j.Payload, &j.Status,
		&j.WorkerID, &j.Attempts, &j.MaxAttempts, &j.Error,
		&j.CreatedAt, &j.ClaimedAt, &j.CompletedAt,
	)
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// ResetStaleClaims resets jobs that were claimed but never completed.
func (q *Queue) ResetStaleClaims(ctx context.Context, timeout time.Duration) (int64, error) {
	tag, err := q.pool.Exec(ctx, `
		UPDATE jobs SET status = 'pending', worker_id = NULL, claimed_at = NULL
		WHERE status = 'claimed' AND claimed_at < $1 AND attempts < max_attempts
	`, time.Now().Add(-timeout))
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
