package store

import (
	"context"

	"github.com/batuhanergun/ecole/api/internal/model"
)

func (s *Store) UpsertUser(ctx context.Context, workosUserID, email, name string) (*model.User, error) {
	var user model.User
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (workos_user_id, email, name)
		VALUES ($1, $2, $3)
		ON CONFLICT (workos_user_id) DO UPDATE SET email = $2, name = $3, updated_at = NOW()
		RETURNING id, workos_user_id, email, name, created_at, updated_at
	`, workosUserID, email, name).Scan(
		&user.ID, &user.WorkOSUserID, &user.Email, &user.Name,
		&user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Store) GetUserByID(ctx context.Context, id string) (*model.User, error) {
	var user model.User
	err := s.pool.QueryRow(ctx, `
		SELECT id, workos_user_id, email, name, created_at, updated_at
		FROM users WHERE id = $1
	`, id).Scan(
		&user.ID, &user.WorkOSUserID, &user.Email, &user.Name,
		&user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Store) GetUserByWorkOSID(ctx context.Context, workosID string) (*model.User, error) {
	var user model.User
	err := s.pool.QueryRow(ctx, `
		SELECT id, workos_user_id, email, name, created_at, updated_at
		FROM users WHERE workos_user_id = $1
	`, workosID).Scan(
		&user.ID, &user.WorkOSUserID, &user.Email, &user.Name,
		&user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &user, nil
}
