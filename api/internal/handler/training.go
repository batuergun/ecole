package handler

import (
	"encoding/json"
	"net/http"

	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/queue"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
)

type TrainingHandler struct {
	store *store.Store
	queue *queue.Queue
}

func NewTrainingHandler(s *store.Store, q *queue.Queue) *TrainingHandler {
	return &TrainingHandler{store: s, queue: q}
}

type launchTrainingRequest struct {
	BaseModel      string          `json:"base_model"`
	LoRAConfig     json.RawMessage `json:"lora_config"`
	TrainingConfig json.RawMessage `json:"training_config"`
	ComputeMode    string          `json:"compute_mode"`
}

func (h *TrainingHandler) Launch(c *gin.Context) {
	var req launchTrainingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if req.BaseModel == "" {
		req.BaseModel = "mistralai/Ministral-3b-instruct"
	}
	if req.ComputeMode == "" {
		req.ComputeMode = "local"
	}
	if req.LoRAConfig == nil {
		req.LoRAConfig = json.RawMessage(`{"r":16,"lora_alpha":32,"lora_dropout":0.05,"target_modules":["q_proj","k_proj","v_proj","o_proj"]}`)
	}
	if req.TrainingConfig == nil {
		req.TrainingConfig = json.RawMessage(`{"num_train_epochs":3,"per_device_train_batch_size":4,"learning_rate":1e-4,"warmup_ratio":0.1,"max_seq_length":2048,"gradient_accumulation_steps":4,"logging_steps":10,"bf16":true}`)
	}

	run, err := h.store.CreateTrainingRun(c.Request.Context(), projectID, req.BaseModel, req.ComputeMode, req.LoRAConfig, req.TrainingConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create training run"})
		return
	}

	payload, _ := json.Marshal(map[string]string{
		"project_id":      projectID,
		"training_run_id": run.ID,
	})
	if _, err := h.queue.Enqueue(c.Request.Context(), "training", projectID, payload); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enqueue training job"})
		return
	}

	h.store.UpdateProjectStatus(c.Request.Context(), projectID, "training")
	c.JSON(http.StatusCreated, run)
}

func (h *TrainingHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	runs, err := h.store.ListTrainingRuns(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list training runs"})
		return
	}
	if runs == nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	c.JSON(http.StatusOK, runs)
}

func (h *TrainingHandler) UploadHF(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")
	trainingRunID := c.Param("tid")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	run, err := h.store.GetTrainingRun(c.Request.Context(), trainingRunID, projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "training run not found"})
		return
	}

	if run.Status != "completed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "training run is not completed"})
		return
	}

	payload, _ := json.Marshal(map[string]string{
		"project_id":      projectID,
		"training_run_id": trainingRunID,
	})
	job, err := h.queue.Enqueue(c.Request.Context(), "hf_upload", projectID, payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enqueue HF upload job"})
		return
	}
	c.JSON(http.StatusCreated, job)
}

func (h *TrainingHandler) Get(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	run, err := h.store.GetTrainingRun(c.Request.Context(), c.Param("tid"), projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "training run not found"})
		return
	}
	c.JSON(http.StatusOK, run)
}
