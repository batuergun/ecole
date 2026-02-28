package store

import (
	"context"
)

func (s *Store) SetAnthropicKey(ctx context.Context, userID string, key []byte) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET anthropic_api_key_enc = $2, updated_at = NOW() WHERE id = $1
	`, userID, key)
	return err
}

func (s *Store) SetHFToken(ctx context.Context, userID string, token []byte) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET hf_api_token_enc = $2, updated_at = NOW() WHERE id = $1
	`, userID, token)
	return err
}

func (s *Store) GetAnthropicKey(ctx context.Context, userID string) ([]byte, error) {
	var key []byte
	err := s.pool.QueryRow(ctx, `
		SELECT anthropic_api_key_enc FROM users WHERE id = $1
	`, userID).Scan(&key)
	return key, err
}

func (s *Store) GetHFToken(ctx context.Context, userID string) ([]byte, error) {
	var token []byte
	err := s.pool.QueryRow(ctx, `
		SELECT hf_api_token_enc FROM users WHERE id = $1
	`, userID).Scan(&token)
	return token, err
}

func (s *Store) GetProjectOwner(ctx context.Context, projectID string) (string, error) {
	var userID string
	err := s.pool.QueryRow(ctx, `SELECT user_id FROM projects WHERE id = $1`, projectID).Scan(&userID)
	return userID, err
}
