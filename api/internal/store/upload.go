package store

import (
	"context"

	"github.com/batuhanergun/ecole/api/internal/model"
)

func (s *Store) CreateUpload(ctx context.Context, projectID, filename, mimeType, storageKey string, sizeBytes int64, pageCount *int) (*model.Upload, error) {
	var u model.Upload
	err := s.pool.QueryRow(ctx, `
		INSERT INTO uploads (project_id, filename, mime_type, size_bytes, storage_key, page_count)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, project_id, filename, mime_type, size_bytes, storage_key, page_count, status, created_at
	`, projectID, filename, mimeType, sizeBytes, storageKey, pageCount).Scan(
		&u.ID, &u.ProjectID, &u.Filename, &u.MimeType, &u.SizeBytes,
		&u.StorageKey, &u.PageCount, &u.Status, &u.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) ListUploads(ctx context.Context, projectID string) ([]model.Upload, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, project_id, filename, mime_type, size_bytes, storage_key, page_count, status, created_at
		FROM uploads WHERE project_id = $1 ORDER BY created_at DESC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var uploads []model.Upload
	for rows.Next() {
		var u model.Upload
		if err := rows.Scan(&u.ID, &u.ProjectID, &u.Filename, &u.MimeType, &u.SizeBytes, &u.StorageKey, &u.PageCount, &u.Status, &u.CreatedAt); err != nil {
			return nil, err
		}
		uploads = append(uploads, u)
	}
	return uploads, nil
}

func (s *Store) DeleteUpload(ctx context.Context, id, projectID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM uploads WHERE id = $1 AND project_id = $2`, id, projectID)
	return err
}
