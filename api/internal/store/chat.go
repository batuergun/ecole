package store

import (
	"context"

	"github.com/batuhanergun/ecole/api/internal/model"
)

// --- Chat Sessions ---

func (s *Store) CreateChatSession(ctx context.Context, projectID, trainingRunID, inferenceMode string) (*model.ChatSession, error) {
	var cs model.ChatSession
	err := s.pool.QueryRow(ctx, `
		INSERT INTO chat_sessions (project_id, training_run_id, inference_mode)
		VALUES ($1, $2, $3)
		RETURNING id, project_id, training_run_id, inference_mode, hf_endpoint_name, hf_endpoint_url,
			hf_endpoint_status, job_id, status, error_message, created_at, updated_at
	`, projectID, trainingRunID, inferenceMode).Scan(
		&cs.ID, &cs.ProjectID, &cs.TrainingRunID, &cs.InferenceMode, &cs.HFEndpointName, &cs.HFEndpointURL,
		&cs.HFEndpointStatus, &cs.JobID, &cs.Status, &cs.ErrorMessage, &cs.CreatedAt, &cs.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &cs, nil
}

func (s *Store) GetChatSession(ctx context.Context, id, projectID string) (*model.ChatSession, error) {
	var cs model.ChatSession
	err := s.pool.QueryRow(ctx, `
		SELECT id, project_id, training_run_id, inference_mode, hf_endpoint_name, hf_endpoint_url,
			hf_endpoint_status, job_id, status, error_message, created_at, updated_at
		FROM chat_sessions WHERE id = $1 AND project_id = $2
	`, id, projectID).Scan(
		&cs.ID, &cs.ProjectID, &cs.TrainingRunID, &cs.InferenceMode, &cs.HFEndpointName, &cs.HFEndpointURL,
		&cs.HFEndpointStatus, &cs.JobID, &cs.Status, &cs.ErrorMessage, &cs.CreatedAt, &cs.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &cs, nil
}

func (s *Store) GetChatSessionByID(ctx context.Context, id string) (*model.ChatSession, error) {
	var cs model.ChatSession
	err := s.pool.QueryRow(ctx, `
		SELECT id, project_id, training_run_id, inference_mode, hf_endpoint_name, hf_endpoint_url,
			hf_endpoint_status, job_id, status, error_message, created_at, updated_at
		FROM chat_sessions WHERE id = $1
	`, id).Scan(
		&cs.ID, &cs.ProjectID, &cs.TrainingRunID, &cs.InferenceMode, &cs.HFEndpointName, &cs.HFEndpointURL,
		&cs.HFEndpointStatus, &cs.JobID, &cs.Status, &cs.ErrorMessage, &cs.CreatedAt, &cs.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &cs, nil
}

func (s *Store) ListChatSessions(ctx context.Context, projectID string) ([]model.ChatSession, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, project_id, training_run_id, inference_mode, hf_endpoint_name, hf_endpoint_url,
			hf_endpoint_status, job_id, status, error_message, created_at, updated_at
		FROM chat_sessions WHERE project_id = $1 ORDER BY created_at DESC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []model.ChatSession
	for rows.Next() {
		var cs model.ChatSession
		if err := rows.Scan(
			&cs.ID, &cs.ProjectID, &cs.TrainingRunID, &cs.InferenceMode, &cs.HFEndpointName, &cs.HFEndpointURL,
			&cs.HFEndpointStatus, &cs.JobID, &cs.Status, &cs.ErrorMessage, &cs.CreatedAt, &cs.UpdatedAt,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, cs)
	}
	return sessions, nil
}

func (s *Store) UpdateChatSessionStatus(ctx context.Context, id, status string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE chat_sessions SET status = $2, updated_at = NOW() WHERE id = $1
	`, id, status)
	return err
}

func (s *Store) UpdateChatSessionError(ctx context.Context, id, errorMsg string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE chat_sessions SET status = 'error', error_message = $2, updated_at = NOW() WHERE id = $1
	`, id, errorMsg)
	return err
}

func (s *Store) UpdateChatSessionEndpoint(ctx context.Context, id string, name, url, status string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE chat_sessions SET hf_endpoint_name = $2, hf_endpoint_url = $3, hf_endpoint_status = $4, updated_at = NOW()
		WHERE id = $1
	`, id, name, url, status)
	return err
}

func (s *Store) SetChatSessionJobID(ctx context.Context, id, jobID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE chat_sessions SET job_id = $2, updated_at = NOW() WHERE id = $1
	`, id, jobID)
	return err
}

func (s *Store) DeleteChatSession(ctx context.Context, id, projectID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM chat_sessions WHERE id = $1 AND project_id = $2`, id, projectID)
	return err
}

// --- Chat Messages ---

func (s *Store) CreateChatMessage(ctx context.Context, sessionID, role, content, status string) (*model.ChatMessage, error) {
	var m model.ChatMessage
	err := s.pool.QueryRow(ctx, `
		INSERT INTO chat_messages (session_id, role, content, status)
		VALUES ($1, $2, $3, $4)
		RETURNING id, session_id, role, content, status, created_at
	`, sessionID, role, content, status).Scan(
		&m.ID, &m.SessionID, &m.Role, &m.Content, &m.Status, &m.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *Store) ListChatMessages(ctx context.Context, sessionID string) ([]model.ChatMessage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, session_id, role, content, status, created_at
		FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []model.ChatMessage
	for rows.Next() {
		var m model.ChatMessage
		if err := rows.Scan(&m.ID, &m.SessionID, &m.Role, &m.Content, &m.Status, &m.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, m)
	}
	return messages, nil
}

func (s *Store) UpdateChatMessage(ctx context.Context, id, content, status string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE chat_messages SET content = $2, status = $3 WHERE id = $1
	`, id, content, status)
	return err
}

func (s *Store) GetPendingChatMessage(ctx context.Context, sessionID string) (*model.ChatMessage, error) {
	var m model.ChatMessage
	err := s.pool.QueryRow(ctx, `
		SELECT id, session_id, role, content, status, created_at
		FROM chat_messages WHERE session_id = $1 AND role = 'assistant' AND status = 'pending'
		ORDER BY created_at ASC LIMIT 1
	`, sessionID).Scan(&m.ID, &m.SessionID, &m.Role, &m.Content, &m.Status, &m.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &m, nil
}
