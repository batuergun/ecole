package store

import (
	"context"
	"encoding/json"

	"github.com/batuhanergun/ecole/api/internal/model"
)

func (s *Store) CreateBenchmark(ctx context.Context, trainingRunID, projectID, modelType string, epoch *int) (*model.Benchmark, error) {
	var b model.Benchmark
	err := s.pool.QueryRow(ctx, `
		INSERT INTO benchmarks (training_run_id, project_id, model_type, epoch)
		VALUES ($1, $2, $3, $4)
		RETURNING id, training_run_id, project_id, model_type, epoch, accuracy, avg_score, total_questions, status, results, created_at, completed_at
	`, trainingRunID, projectID, modelType, epoch).Scan(
		&b.ID, &b.TrainingRunID, &b.ProjectID, &b.ModelType, &b.Epoch,
		&b.Accuracy, &b.AvgScore, &b.TotalQuestions, &b.Status, &b.Results,
		&b.CreatedAt, &b.CompletedAt,
	)
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func (s *Store) ListBenchmarks(ctx context.Context, projectID string) ([]model.Benchmark, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, training_run_id, project_id, model_type, epoch, accuracy, avg_score, total_questions, status, results, created_at, completed_at
		FROM benchmarks WHERE project_id = $1 ORDER BY created_at DESC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var benchmarks []model.Benchmark
	for rows.Next() {
		var b model.Benchmark
		if err := rows.Scan(&b.ID, &b.TrainingRunID, &b.ProjectID, &b.ModelType, &b.Epoch, &b.Accuracy, &b.AvgScore, &b.TotalQuestions, &b.Status, &b.Results, &b.CreatedAt, &b.CompletedAt); err != nil {
			return nil, err
		}
		benchmarks = append(benchmarks, b)
	}
	return benchmarks, nil
}

func (s *Store) CompleteBenchmark(ctx context.Context, id string, accuracy, avgScore float64, totalQuestions int, results json.RawMessage) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE benchmarks SET status = 'completed', accuracy = $2, avg_score = $3, total_questions = $4, results = $5, completed_at = NOW()
		WHERE id = $1
	`, id, accuracy, avgScore, totalQuestions, results)
	return err
}

func (s *Store) FailBenchmark(ctx context.Context, id, errorMsg string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE benchmarks SET status = 'failed', completed_at = NOW() WHERE id = $1
	`, id)
	return err
}
