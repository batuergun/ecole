package store

import (
	"context"
	"encoding/json"

	"github.com/batuhanergun/ecole/api/internal/model"
)

func (s *Store) CreateChunk(ctx context.Context, uploadID string, chunkIndex int, content string, metadata json.RawMessage) (*model.Chunk, error) {
	if metadata == nil {
		metadata = json.RawMessage(`{}`)
	}
	var c model.Chunk
	err := s.pool.QueryRow(ctx, `
		INSERT INTO chunks (upload_id, chunk_index, content, metadata)
		VALUES ($1, $2, $3, $4)
		RETURNING id, upload_id, chunk_index, content, metadata, created_at
	`, uploadID, chunkIndex, content, metadata).Scan(
		&c.ID, &c.UploadID, &c.ChunkIndex, &c.Content, &c.Metadata, &c.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) ListChunks(ctx context.Context, uploadID string) ([]model.Chunk, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, upload_id, chunk_index, content, metadata, created_at
		FROM chunks WHERE upload_id = $1 ORDER BY chunk_index
	`, uploadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var chunks []model.Chunk
	for rows.Next() {
		var c model.Chunk
		if err := rows.Scan(&c.ID, &c.UploadID, &c.ChunkIndex, &c.Content, &c.Metadata, &c.CreatedAt); err != nil {
			return nil, err
		}
		chunks = append(chunks, c)
	}
	return chunks, nil
}
