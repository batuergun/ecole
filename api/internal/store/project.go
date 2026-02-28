package store

import (
	"context"
	"encoding/json"

	"github.com/batuhanergun/ecole/api/internal/model"
)

func (s *Store) CreateProject(ctx context.Context, userID, name, description string, projContext json.RawMessage) (*model.Project, error) {
	if projContext == nil {
		projContext = json.RawMessage(`{}`)
	}
	var p model.Project
	err := s.pool.QueryRow(ctx, `
		INSERT INTO projects (user_id, name, description, context)
		VALUES ($1, $2, $3, $4)
		RETURNING id, user_id, name, description, context, status, created_at, updated_at
	`, userID, name, description, projContext).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description, &p.Context,
		&p.Status, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) ListProjects(ctx context.Context, userID string) ([]model.Project, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, name, description, context, status, created_at, updated_at
		FROM projects WHERE user_id = $1 ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []model.Project
	for rows.Next() {
		var p model.Project
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Description, &p.Context, &p.Status, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, nil
}

func (s *Store) GetProject(ctx context.Context, id, userID string) (*model.Project, error) {
	var p model.Project
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, name, description, context, status, created_at, updated_at
		FROM projects WHERE id = $1 AND user_id = $2
	`, id, userID).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description, &p.Context,
		&p.Status, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) UpdateProject(ctx context.Context, id, userID, name, description string, projContext json.RawMessage) (*model.Project, error) {
	var p model.Project
	err := s.pool.QueryRow(ctx, `
		UPDATE projects SET name = $3, description = $4, context = $5, updated_at = NOW()
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, name, description, context, status, created_at, updated_at
	`, id, userID, name, description, projContext).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description, &p.Context,
		&p.Status, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) DeleteProject(ctx context.Context, id, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM projects WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

func (s *Store) UpdateProjectStatus(ctx context.Context, id, status string) error {
	_, err := s.pool.Exec(ctx, `UPDATE projects SET status = $2, updated_at = NOW() WHERE id = $1`, id, status)
	return err
}
