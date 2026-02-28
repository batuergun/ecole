package store

import (
	"context"
	"encoding/json"

	"github.com/batuhanergun/ecole/api/internal/model"
)

func (s *Store) CreateTrainingRun(ctx context.Context, projectID, baseModel, computeMode string, hfFlavor, hfNamespace *string, loraConfig, trainingConfig json.RawMessage) (*model.TrainingRun, error) {
	var t model.TrainingRun
	err := s.pool.QueryRow(ctx, `
		INSERT INTO training_runs (project_id, base_model, lora_config, training_config, compute_mode, hf_flavor, hf_namespace)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, project_id, base_model, lora_config, training_config, compute_mode, hf_flavor, hf_namespace,
			hf_job_id, hf_dataset_repo, worker_id, status, current_epoch, total_epochs, train_loss,
			current_step, total_steps, grad_norm, learning_rate_current,
			output_model_path, hf_repo_id, error_message, started_at, completed_at, created_at, updated_at
	`, projectID, baseModel, loraConfig, trainingConfig, computeMode, hfFlavor, hfNamespace).Scan(
		&t.ID, &t.ProjectID, &t.BaseModel, &t.LoRAConfig, &t.TrainingConfig, &t.ComputeMode, &t.HFFlavor, &t.HFNamespace,
		&t.HFJobID, &t.HFDatasetRepo, &t.WorkerID, &t.Status, &t.CurrentEpoch, &t.TotalEpochs, &t.TrainLoss,
		&t.CurrentStep, &t.TotalSteps, &t.GradNorm, &t.LearningRateCur,
		&t.OutputModelPath, &t.HFRepoID, &t.ErrorMessage, &t.StartedAt, &t.CompletedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) GetTrainingRunByID(ctx context.Context, id string) (*model.TrainingRun, error) {
	var t model.TrainingRun
	err := s.pool.QueryRow(ctx, `
		SELECT id, project_id, base_model, lora_config, training_config, compute_mode, hf_flavor, hf_namespace,
			hf_job_id, hf_dataset_repo, worker_id, status, current_epoch, total_epochs, train_loss,
			current_step, total_steps, grad_norm, learning_rate_current,
			output_model_path, hf_repo_id, error_message, started_at, completed_at, created_at, updated_at
		FROM training_runs WHERE id = $1
	`, id).Scan(
		&t.ID, &t.ProjectID, &t.BaseModel, &t.LoRAConfig, &t.TrainingConfig, &t.ComputeMode, &t.HFFlavor, &t.HFNamespace,
		&t.HFJobID, &t.HFDatasetRepo, &t.WorkerID, &t.Status, &t.CurrentEpoch, &t.TotalEpochs, &t.TrainLoss,
		&t.CurrentStep, &t.TotalSteps, &t.GradNorm, &t.LearningRateCur,
		&t.OutputModelPath, &t.HFRepoID, &t.ErrorMessage, &t.StartedAt, &t.CompletedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) GetTrainingRun(ctx context.Context, id, projectID string) (*model.TrainingRun, error) {
	var t model.TrainingRun
	err := s.pool.QueryRow(ctx, `
		SELECT id, project_id, base_model, lora_config, training_config, compute_mode, hf_flavor, hf_namespace,
			hf_job_id, hf_dataset_repo, worker_id, status, current_epoch, total_epochs, train_loss,
			current_step, total_steps, grad_norm, learning_rate_current,
			output_model_path, hf_repo_id, error_message, started_at, completed_at, created_at, updated_at
		FROM training_runs WHERE id = $1 AND project_id = $2
	`, id, projectID).Scan(
		&t.ID, &t.ProjectID, &t.BaseModel, &t.LoRAConfig, &t.TrainingConfig, &t.ComputeMode, &t.HFFlavor, &t.HFNamespace,
		&t.HFJobID, &t.HFDatasetRepo, &t.WorkerID, &t.Status, &t.CurrentEpoch, &t.TotalEpochs, &t.TrainLoss,
		&t.CurrentStep, &t.TotalSteps, &t.GradNorm, &t.LearningRateCur,
		&t.OutputModelPath, &t.HFRepoID, &t.ErrorMessage, &t.StartedAt, &t.CompletedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) ListTrainingRuns(ctx context.Context, projectID string) ([]model.TrainingRun, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, project_id, base_model, lora_config, training_config, compute_mode, hf_flavor, hf_namespace,
			hf_job_id, hf_dataset_repo, worker_id, status, current_epoch, total_epochs, train_loss,
			current_step, total_steps, grad_norm, learning_rate_current,
			output_model_path, hf_repo_id, error_message, started_at, completed_at, created_at, updated_at
		FROM training_runs WHERE project_id = $1 ORDER BY created_at DESC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []model.TrainingRun
	for rows.Next() {
		var t model.TrainingRun
		if err := rows.Scan(
			&t.ID, &t.ProjectID, &t.BaseModel, &t.LoRAConfig, &t.TrainingConfig, &t.ComputeMode, &t.HFFlavor, &t.HFNamespace,
			&t.HFJobID, &t.HFDatasetRepo, &t.WorkerID, &t.Status, &t.CurrentEpoch, &t.TotalEpochs, &t.TrainLoss,
			&t.CurrentStep, &t.TotalSteps, &t.GradNorm, &t.LearningRateCur,
			&t.OutputModelPath, &t.HFRepoID, &t.ErrorMessage, &t.StartedAt, &t.CompletedAt, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		runs = append(runs, t)
	}
	return runs, nil
}

func (s *Store) UpdateTrainingProgress(ctx context.Context, id string, status string, epoch int, loss *float64, currentStep int, totalSteps *int, gradNorm *float64, learningRate *float64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE training_runs SET status = $2, current_epoch = $3, train_loss = $4,
			current_step = $5, total_steps = $6, grad_norm = $7, learning_rate_current = $8,
			updated_at = NOW()
		WHERE id = $1
	`, id, status, epoch, loss, currentStep, totalSteps, gradNorm, learningRate)
	return err
}

func (s *Store) UpdateTrainingLogs(ctx context.Context, id string, logs string) error {
	_, err := s.pool.Exec(ctx, `UPDATE training_runs SET logs = $2, updated_at = NOW() WHERE id = $1`, id, logs)
	return err
}

func (s *Store) GetTrainingLogs(ctx context.Context, id string) (string, error) {
	var logs string
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(logs, '') FROM training_runs WHERE id = $1`, id).Scan(&logs)
	return logs, err
}

func (s *Store) CompleteTrainingRun(ctx context.Context, id, outputPath string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE training_runs SET status = 'completed', output_model_path = $2, completed_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, id, outputPath)
	return err
}

func (s *Store) FailTrainingRun(ctx context.Context, id, errorMsg string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE training_runs SET status = 'failed', error_message = $2, completed_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, id, errorMsg)
	return err
}

func (s *Store) SetTrainingHFRepo(ctx context.Context, id, repoID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE training_runs SET hf_repo_id = $2, updated_at = NOW() WHERE id = $1
	`, id, repoID)
	return err
}

func (s *Store) SetHFJobID(ctx context.Context, id, jobID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE training_runs SET hf_job_id = $2, updated_at = NOW() WHERE id = $1`, id, jobID)
	return err
}

func (s *Store) SetHFDatasetRepo(ctx context.Context, id, repoID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE training_runs SET hf_dataset_repo = $2, updated_at = NOW() WHERE id = $1`, id, repoID)
	return err
}

func (s *Store) DeleteTrainingRun(ctx context.Context, id, projectID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM training_runs WHERE id = $1 AND project_id = $2`, id, projectID)
	return err
}
