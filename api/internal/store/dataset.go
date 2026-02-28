package store

import (
	"context"
	"fmt"

	"github.com/batuhanergun/ecole/api/internal/model"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateDatasetItem(ctx context.Context, projectID string, chunkID *string, question, answer string, isEval bool) (*model.DatasetItem, error) {
	var d model.DatasetItem
	err := s.pool.QueryRow(ctx, `
		INSERT INTO dataset_items (project_id, chunk_id, question, answer, is_eval)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, project_id, chunk_id, question, answer, is_eval, is_edited, is_deleted, created_at, updated_at
	`, projectID, chunkID, question, answer, isEval).Scan(
		&d.ID, &d.ProjectID, &d.ChunkID, &d.Question, &d.Answer,
		&d.IsEval, &d.IsEdited, &d.IsDeleted, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

type DatasetItemInput struct {
	ChunkID  *string
	Question string
	Answer   string
	IsEval   bool
}

func (s *Store) BatchCreateDatasetItems(ctx context.Context, projectID string, items []DatasetItemInput) error {
	batch := &pgx.Batch{}
	for _, item := range items {
		batch.Queue(`
			INSERT INTO dataset_items (project_id, chunk_id, question, answer, is_eval)
			VALUES ($1, $2, $3, $4, $5)
		`, projectID, item.ChunkID, item.Question, item.Answer, item.IsEval)
	}
	br := s.pool.SendBatch(ctx, batch)
	defer br.Close()
	for range items {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("batch insert failed: %w", err)
		}
	}
	return nil
}

func (s *Store) ListDatasetItems(ctx context.Context, projectID string, evalOnly bool, limit, offset int) ([]model.DatasetItem, int, error) {
	var total int
	query := `SELECT COUNT(*) FROM dataset_items WHERE project_id = $1 AND is_deleted = false`
	args := []any{projectID}
	if evalOnly {
		query += ` AND is_eval = true`
	}
	if err := s.pool.QueryRow(ctx, query, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	dataQuery := `
		SELECT id, project_id, chunk_id, question, answer, is_eval, is_edited, is_deleted, created_at, updated_at
		FROM dataset_items WHERE project_id = $1 AND is_deleted = false`
	if evalOnly {
		dataQuery += ` AND is_eval = true`
	}
	dataQuery += ` ORDER BY created_at LIMIT $2 OFFSET $3`

	rows, err := s.pool.Query(ctx, dataQuery, projectID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []model.DatasetItem
	for rows.Next() {
		var d model.DatasetItem
		if err := rows.Scan(&d.ID, &d.ProjectID, &d.ChunkID, &d.Question, &d.Answer, &d.IsEval, &d.IsEdited, &d.IsDeleted, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, d)
	}
	return items, total, nil
}

func (s *Store) UpdateDatasetItem(ctx context.Context, id, projectID, question, answer string) (*model.DatasetItem, error) {
	var d model.DatasetItem
	err := s.pool.QueryRow(ctx, `
		UPDATE dataset_items SET question = $3, answer = $4, is_edited = true, updated_at = NOW()
		WHERE id = $1 AND project_id = $2
		RETURNING id, project_id, chunk_id, question, answer, is_eval, is_edited, is_deleted, created_at, updated_at
	`, id, projectID, question, answer).Scan(
		&d.ID, &d.ProjectID, &d.ChunkID, &d.Question, &d.Answer,
		&d.IsEval, &d.IsEdited, &d.IsDeleted, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (s *Store) DeleteDatasetItem(ctx context.Context, id, projectID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE dataset_items SET is_deleted = true, updated_at = NOW() WHERE id = $1 AND project_id = $2`, id, projectID)
	return err
}
