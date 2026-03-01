package handler

import (
	"encoding/json"
	"net/http"

	"github.com/batuhanergun/ecole/api/internal/config"
	"github.com/batuhanergun/ecole/api/internal/crypto"
	"github.com/batuhanergun/ecole/api/internal/queue"
	"github.com/batuhanergun/ecole/api/internal/storage"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

type WorkerHandler struct {
	store   *store.Store
	queue   *queue.Queue
	storage *storage.Storage
	cfg     *config.Config
}

func NewWorkerHandler(s *store.Store, q *queue.Queue, st *storage.Storage, cfg *config.Config) *WorkerHandler {
	return &WorkerHandler{store: s, queue: q, storage: st, cfg: cfg}
}

func (h *WorkerHandler) Poll(c *gin.Context) {
	workerID := c.Query("worker_id")
	if workerID == "" {
		workerID = "anonymous"
	}

	job, err := h.queue.Claim(c.Request.Context(), workerID)
	if err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNoContent, nil)
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to poll"})
		return
	}
	c.JSON(http.StatusOK, job)
}

type progressRequest struct {
	Status string          `json:"status"`
	Data   json.RawMessage `json:"data"`
}

func (h *WorkerHandler) Progress(c *gin.Context) {
	var req progressRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	jobID := c.Param("jid")
	if err := h.queue.UpdateProgress(c.Request.Context(), jobID, req.Status, req.Data); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update progress"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *WorkerHandler) Complete(c *gin.Context) {
	jobID := c.Param("jid")
	if err := h.queue.Complete(c.Request.Context(), jobID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to complete job"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type failRequest struct {
	Error string `json:"error" binding:"required"`
}

func (h *WorkerHandler) Fail(c *gin.Context) {
	var req failRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	jobID := c.Param("jid")
	if err := h.queue.Fail(c.Request.Context(), jobID, req.Error); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fail job"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetProject returns project details for the worker.
func (h *WorkerHandler) GetProject(c *gin.Context) {
	projectID := c.Param("pid")
	// Worker bypasses user ownership check
	var p struct {
		ID          string          `json:"id"`
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Context     json.RawMessage `json:"context"`
		Status      string          `json:"status"`
	}
	err := h.store.Pool().QueryRow(c.Request.Context(), `
		SELECT id, name, description, context, status FROM projects WHERE id = $1
	`, projectID).Scan(&p.ID, &p.Name, &p.Description, &p.Context, &p.Status)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}
	c.JSON(http.StatusOK, p)
}

// GetUploads returns uploads for a project (worker use).
func (h *WorkerHandler) GetUploads(c *gin.Context) {
	projectID := c.Param("pid")
	uploads, err := h.store.ListUploads(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list uploads"})
		return
	}
	if uploads == nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	c.JSON(http.StatusOK, uploads)
}

// DownloadFile serves an uploaded file to the worker.
func (h *WorkerHandler) DownloadFile(c *gin.Context) {
	storageKey := c.Query("key")
	if storageKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing key param"})
		return
	}
	filePath := h.storage.Path(storageKey)
	c.File(filePath)
}

// CreateChunk stores an extracted chunk.
type createChunkRequest struct {
	UploadID   string          `json:"upload_id" binding:"required"`
	ChunkIndex int             `json:"chunk_index"`
	Content    string          `json:"content" binding:"required"`
	Metadata   json.RawMessage `json:"metadata"`
}

func (h *WorkerHandler) CreateChunk(c *gin.Context) {
	var req createChunkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	chunk, err := h.store.CreateChunk(c.Request.Context(), req.UploadID, req.ChunkIndex, req.Content, req.Metadata)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create chunk"})
		return
	}
	c.JSON(http.StatusCreated, chunk)
}

// BatchCreateDataset inserts multiple Q&A pairs at once.
type batchDatasetRequest struct {
	ProjectID string `json:"project_id" binding:"required"`
	Items     []struct {
		ChunkID  *string `json:"chunk_id"`
		Question string  `json:"question" binding:"required"`
		Answer   string  `json:"answer" binding:"required"`
		IsEval   bool    `json:"is_eval"`
	} `json:"items" binding:"required"`
}

func (h *WorkerHandler) BatchCreateDataset(c *gin.Context) {
	var req batchDatasetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items := make([]store.DatasetItemInput, len(req.Items))
	for i, item := range req.Items {
		items[i] = store.DatasetItemInput{
			ChunkID:  item.ChunkID,
			Question: item.Question,
			Answer:   item.Answer,
			IsEval:   item.IsEval,
		}
	}

	if err := h.store.BatchCreateDatasetItems(c.Request.Context(), req.ProjectID, items); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to batch insert"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"inserted": len(items)})
}

// GetAPIKeys returns decrypted API keys for a project's owner.
func (h *WorkerHandler) GetAPIKeys(c *gin.Context) {
	projectID := c.Param("pid")

	userID, err := h.store.GetProjectOwner(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	result := gin.H{}

	anthropicEnc, err := h.store.GetAnthropicKey(c.Request.Context(), userID)
	if err == nil && len(anthropicEnc) > 0 {
		if dec, err := crypto.Decrypt(anthropicEnc, h.cfg.EncryptionKey); err == nil {
			result["anthropic_key"] = string(dec)
		}
	}

	mistralEnc, err := h.store.GetMistralKey(c.Request.Context(), userID)
	if err == nil && len(mistralEnc) > 0 {
		if dec, err := crypto.Decrypt(mistralEnc, h.cfg.EncryptionKey); err == nil {
			result["mistral_key"] = string(dec)
		}
	}

	hfEnc, err := h.store.GetHFToken(c.Request.Context(), userID)
	if err == nil && len(hfEnc) > 0 {
		if dec, err := crypto.Decrypt(hfEnc, h.cfg.EncryptionKey); err == nil {
			result["hf_token"] = string(dec)
		}
	}

	c.JSON(http.StatusOK, result)
}

// --- Training run operations ---

// GetTrainingRun returns training run details for the worker.
func (h *WorkerHandler) GetTrainingRun(c *gin.Context) {
	tid := c.Param("tid")
	run, err := h.store.GetTrainingRunByID(c.Request.Context(), tid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "training run not found"})
		return
	}
	c.JSON(http.StatusOK, run)
}

// UpdateTrainingProgress lets the worker update training run progress.
func (h *WorkerHandler) UpdateTrainingProgress(c *gin.Context) {
	tid := c.Param("tid")
	var req struct {
		Status       string   `json:"status"`
		Epoch        int      `json:"epoch"`
		Loss         *float64 `json:"loss"`
		CurrentStep  int      `json:"current_step"`
		TotalSteps   *int     `json:"total_steps"`
		GradNorm     *float64 `json:"grad_norm"`
		LearningRate *float64 `json:"learning_rate"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Status == "" {
		req.Status = "training"
	}
	if err := h.store.UpdateTrainingProgress(c.Request.Context(), tid, req.Status, req.Epoch, req.Loss, req.CurrentStep, req.TotalSteps, req.GradNorm, req.LearningRate); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update progress"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// UpdateTrainingLogs lets the worker update training run logs.
func (h *WorkerHandler) UpdateTrainingLogs(c *gin.Context) {
	tid := c.Param("tid")
	var req struct {
		Logs string `json:"logs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.UpdateTrainingLogs(c.Request.Context(), tid, req.Logs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update logs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// CompleteTrainingRun marks a training run as completed.
func (h *WorkerHandler) CompleteTrainingRun(c *gin.Context) {
	tid := c.Param("tid")
	var req struct {
		OutputPath string `json:"output_path" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.CompleteTrainingRun(c.Request.Context(), tid, req.OutputPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to complete training run"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// FailTrainingRun marks a training run as failed.
func (h *WorkerHandler) FailTrainingRun(c *gin.Context) {
	tid := c.Param("tid")
	var req struct {
		Error string `json:"error" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.FailTrainingRun(c.Request.Context(), tid, req.Error); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fail training run"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// SetHFJobID stores the HuggingFace job URL on a training run.
func (h *WorkerHandler) SetHFJobID(c *gin.Context) {
	tid := c.Param("tid")
	var req struct {
		JobID string `json:"job_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.SetHFJobID(c.Request.Context(), tid, req.JobID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to set HF job ID"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// SetHFDatasetRepo stores the HuggingFace dataset repo on a training run.
func (h *WorkerHandler) SetHFDatasetRepo(c *gin.Context) {
	tid := c.Param("tid")
	var req struct {
		RepoID string `json:"repo_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.SetHFDatasetRepo(c.Request.Context(), tid, req.RepoID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to set HF dataset repo"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// SetTrackioURL stores the Trackio dashboard URL on a training run.
func (h *WorkerHandler) SetTrackioURL(c *gin.Context) {
	tid := c.Param("tid")
	var req struct {
		URL string `json:"url" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.SetTrackioURL(c.Request.Context(), tid, req.URL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to set trackio URL"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// SetTrainingHFRepo sets the HF repo ID on a training run.
func (h *WorkerHandler) SetTrainingHFRepo(c *gin.Context) {
	tid := c.Param("tid")
	var req struct {
		RepoID string `json:"repo_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.SetTrainingHFRepo(c.Request.Context(), tid, req.RepoID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to set HF repo"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// --- Benchmark operations ---

// CreateBenchmark creates a new benchmark record.
func (h *WorkerHandler) CreateBenchmarkRecord(c *gin.Context) {
	var req struct {
		TrainingRunID string `json:"training_run_id" binding:"required"`
		ProjectID     string `json:"project_id" binding:"required"`
		ModelType     string `json:"model_type" binding:"required"`
		Epoch         *int   `json:"epoch"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.store.CreateBenchmark(c.Request.Context(), req.TrainingRunID, req.ProjectID, req.ModelType, req.Epoch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create benchmark"})
		return
	}
	c.JSON(http.StatusCreated, b)
}

// CompleteBenchmarkRecord completes a benchmark with results.
func (h *WorkerHandler) CompleteBenchmarkRecord(c *gin.Context) {
	bid := c.Param("bid")
	var req struct {
		Accuracy           float64         `json:"accuracy"`
		AvgScore           float64         `json:"avg_score"`
		SemanticSimilarity *float64        `json:"semantic_similarity"`
		RougeL             *float64        `json:"rouge_l"`
		TotalQuestions     int             `json:"total_questions"`
		Results            json.RawMessage `json:"results"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.CompleteBenchmark(c.Request.Context(), bid, req.Accuracy, req.AvgScore, req.SemanticSimilarity, req.RougeL, req.TotalQuestions, req.Results); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to complete benchmark"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// --- Chat session operations ---

// GetChatSession returns chat session details for the worker.
func (h *WorkerHandler) GetChatSession(c *gin.Context) {
	sid := c.Param("sid")
	session, err := h.store.GetChatSessionByID(c.Request.Context(), sid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat session not found"})
		return
	}
	c.JSON(http.StatusOK, session)
}

// UpdateChatSessionStatus lets the worker update chat session status.
func (h *WorkerHandler) UpdateChatSessionStatus(c *gin.Context) {
	sid := c.Param("sid")
	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.UpdateChatSessionStatus(c.Request.Context(), sid, req.Status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update status"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetPendingChatMessage returns the next pending assistant message for a session.
func (h *WorkerHandler) GetPendingChatMessage(c *gin.Context) {
	sid := c.Param("sid")
	msg, err := h.store.GetPendingChatMessage(c.Request.Context(), sid)
	if err != nil {
		c.JSON(http.StatusNoContent, nil)
		return
	}
	c.JSON(http.StatusOK, msg)
}

// ListChatMessages returns all messages for a chat session (for worker context building).
func (h *WorkerHandler) ListChatMessages(c *gin.Context) {
	sid := c.Param("sid")
	messages, err := h.store.ListChatMessages(c.Request.Context(), sid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list messages"})
		return
	}
	if messages == nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	c.JSON(http.StatusOK, messages)
}

// UpdateChatMessage lets the worker update a chat message content and status.
func (h *WorkerHandler) UpdateChatMessage(c *gin.Context) {
	mid := c.Param("mid")
	var req struct {
		Content string `json:"content"`
		Status  string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.UpdateChatMessage(c.Request.Context(), mid, req.Content, req.Status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update message"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// UpdateProjectStatus lets the worker update project status.
func (h *WorkerHandler) UpdateProjectStatus(c *gin.Context) {
	projectID := c.Param("pid")
	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.UpdateProjectStatus(c.Request.Context(), projectID, req.Status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update status"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
