package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
)

type ActivityHandler struct {
	store *store.Store
}

func NewActivityHandler(s *store.Store) *ActivityHandler {
	return &ActivityHandler{store: s}
}

type trainingRunItem struct {
	ID              string     `json:"id"`
	ProjectID       string     `json:"project_id"`
	ProjectName     string     `json:"project_name"`
	BaseModel       string     `json:"base_model"`
	ComputeMode     string     `json:"compute_mode"`
	HFJobID         *string    `json:"hf_job_id"`
	Status          string     `json:"status"`
	CurrentEpoch    int        `json:"current_epoch"`
	TotalEpochs     *int       `json:"total_epochs"`
	TrainLoss       *float64   `json:"train_loss"`
	CurrentStep     int        `json:"current_step"`
	TotalSteps      *int       `json:"total_steps"`
	GradNorm        *float64   `json:"grad_norm"`
	LearningRateCur *float64   `json:"learning_rate_current"`
	HFRepoID        *string    `json:"hf_repo_id"`
	ErrorMessage    *string    `json:"error_message"`
	StartedAt       *time.Time `json:"started_at"`
	CompletedAt     *time.Time `json:"completed_at"`
	CreatedAt       time.Time  `json:"created_at"`
}

type jobItem struct {
	ID           string          `json:"id"`
	JobType      string          `json:"job_type"`
	ProjectID    string          `json:"project_id"`
	ProjectName  string          `json:"project_name"`
	Status       string          `json:"status"`
	Error        *string         `json:"error"`
	ProgressData json.RawMessage `json:"progress_data"`
	CreatedAt    time.Time       `json:"created_at"`
	ClaimedAt    *time.Time      `json:"claimed_at"`
	CompletedAt  *time.Time      `json:"completed_at"`
}

type activityResponse struct {
	TrainingRuns []trainingRunItem `json:"training_runs"`
	Jobs         []jobItem         `json:"jobs"`
}

func (h *ActivityHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)

	// Fetch training runs with project name
	trRows, err := h.store.Pool().Query(c.Request.Context(), `
		SELECT t.id, t.project_id, p.name, t.base_model, t.compute_mode,
			t.hf_job_id, t.status, t.current_epoch, t.total_epochs, t.train_loss,
			t.current_step, t.total_steps, t.grad_norm, t.learning_rate_current,
			t.hf_repo_id, t.error_message, t.started_at, t.completed_at, t.created_at
		FROM training_runs t
		JOIN projects p ON p.id = t.project_id
		WHERE p.user_id = $1
		ORDER BY t.created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list training runs"})
		return
	}
	defer trRows.Close()

	var runs []trainingRunItem
	for trRows.Next() {
		var r trainingRunItem
		if err := trRows.Scan(
			&r.ID, &r.ProjectID, &r.ProjectName, &r.BaseModel, &r.ComputeMode,
			&r.HFJobID, &r.Status, &r.CurrentEpoch, &r.TotalEpochs, &r.TrainLoss,
			&r.CurrentStep, &r.TotalSteps, &r.GradNorm, &r.LearningRateCur,
			&r.HFRepoID, &r.ErrorMessage, &r.StartedAt, &r.CompletedAt, &r.CreatedAt,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan training run"})
			return
		}
		runs = append(runs, r)
	}

	// Fetch queue jobs with project name
	jRows, err := h.store.Pool().Query(c.Request.Context(), `
		SELECT j.id, j.job_type, j.project_id, p.name, j.status,
			j.error, j.progress_data, j.created_at, j.claimed_at, j.completed_at
		FROM jobs j
		JOIN projects p ON p.id = j.project_id
		WHERE p.user_id = $1
		ORDER BY j.created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list jobs"})
		return
	}
	defer jRows.Close()

	var jobs []jobItem
	for jRows.Next() {
		var j jobItem
		if err := jRows.Scan(
			&j.ID, &j.JobType, &j.ProjectID, &j.ProjectName, &j.Status,
			&j.Error, &j.ProgressData, &j.CreatedAt, &j.ClaimedAt, &j.CompletedAt,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan job"})
			return
		}
		jobs = append(jobs, j)
	}

	if runs == nil {
		runs = []trainingRunItem{}
	}
	if jobs == nil {
		jobs = []jobItem{}
	}

	c.JSON(http.StatusOK, activityResponse{
		TrainingRuns: runs,
		Jobs:         jobs,
	})
}
