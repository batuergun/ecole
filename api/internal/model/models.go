package model

import (
	"encoding/json"
	"time"
)

type User struct {
	ID               string    `json:"id" db:"id"`
	WorkOSUserID     string    `json:"workos_user_id" db:"workos_user_id"`
	Email            string    `json:"email" db:"email"`
	Name             string    `json:"name" db:"name"`
	AnthropicKeyEnc  []byte    `json:"-" db:"anthropic_api_key_enc"`
	MistralKeyEnc    []byte    `json:"-" db:"mistral_api_key_enc"`
	HFTokenEnc       []byte    `json:"-" db:"hf_api_token_enc"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}

type Project struct {
	ID          string          `json:"id" db:"id"`
	UserID      string          `json:"user_id" db:"user_id"`
	Name        string          `json:"name" db:"name"`
	Description string          `json:"description" db:"description"`
	Context     json.RawMessage `json:"context" db:"context"`
	Status      string          `json:"status" db:"status"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at" db:"updated_at"`
}

type Upload struct {
	ID         string    `json:"id" db:"id"`
	ProjectID  string    `json:"project_id" db:"project_id"`
	Filename   string    `json:"filename" db:"filename"`
	MimeType   string    `json:"mime_type" db:"mime_type"`
	SizeBytes  int64     `json:"size_bytes" db:"size_bytes"`
	StorageKey string    `json:"storage_key" db:"storage_key"`
	PageCount  *int      `json:"page_count" db:"page_count"`
	Status     string    `json:"status" db:"status"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
}

type Chunk struct {
	ID          string          `json:"id" db:"id"`
	UploadID    string          `json:"upload_id" db:"upload_id"`
	ChunkIndex  int             `json:"chunk_index" db:"chunk_index"`
	Content     string          `json:"content" db:"content"`
	Metadata    json.RawMessage `json:"metadata" db:"metadata"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
}

type DatasetItem struct {
	ID        string    `json:"id" db:"id"`
	ProjectID string    `json:"project_id" db:"project_id"`
	ChunkID   *string   `json:"chunk_id" db:"chunk_id"`
	Question  string    `json:"question" db:"question"`
	Answer    string    `json:"answer" db:"answer"`
	IsEval    bool      `json:"is_eval" db:"is_eval"`
	IsEdited  bool      `json:"is_edited" db:"is_edited"`
	IsDeleted bool      `json:"is_deleted" db:"is_deleted"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type TrainingRun struct {
	ID              string          `json:"id" db:"id"`
	ProjectID       string          `json:"project_id" db:"project_id"`
	BaseModel       string          `json:"base_model" db:"base_model"`
	LoRAConfig      json.RawMessage `json:"lora_config" db:"lora_config"`
	TrainingConfig  json.RawMessage `json:"training_config" db:"training_config"`
	ComputeMode     string          `json:"compute_mode" db:"compute_mode"`
	HFFlavor        *string         `json:"hf_flavor" db:"hf_flavor"`
	HFNamespace     *string         `json:"hf_namespace" db:"hf_namespace"`
	HFJobID         *string         `json:"hf_job_id" db:"hf_job_id"`
	HFDatasetRepo   *string         `json:"hf_dataset_repo" db:"hf_dataset_repo"`
	WorkerID        *string         `json:"worker_id" db:"worker_id"`
	Status          string          `json:"status" db:"status"`
	CurrentEpoch    int             `json:"current_epoch" db:"current_epoch"`
	TotalEpochs     *int            `json:"total_epochs" db:"total_epochs"`
	TrainLoss       *float64        `json:"train_loss" db:"train_loss"`
	CurrentStep     int             `json:"current_step" db:"current_step"`
	TotalSteps      *int            `json:"total_steps" db:"total_steps"`
	GradNorm        *float64        `json:"grad_norm" db:"grad_norm"`
	LearningRateCur *float64        `json:"learning_rate_current" db:"learning_rate_current"`
	OutputModelPath *string         `json:"output_model_path" db:"output_model_path"`
	HFRepoID        *string         `json:"hf_repo_id" db:"hf_repo_id"`
	TrackioURL      *string         `json:"trackio_url" db:"trackio_url"`
	ErrorMessage    *string         `json:"error_message" db:"error_message"`
	StartedAt       *time.Time      `json:"started_at" db:"started_at"`
	CompletedAt     *time.Time      `json:"completed_at" db:"completed_at"`
	CreatedAt       time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at" db:"updated_at"`
}

type Benchmark struct {
	ID                 string          `json:"id" db:"id"`
	TrainingRunID      string          `json:"training_run_id" db:"training_run_id"`
	ProjectID          string          `json:"project_id" db:"project_id"`
	ModelType          string          `json:"model_type" db:"model_type"`
	Epoch              *int            `json:"epoch" db:"epoch"`
	Accuracy           *float64        `json:"accuracy" db:"accuracy"`
	AvgScore           *float64        `json:"avg_score" db:"avg_score"`
	SemanticSimilarity *float64        `json:"semantic_similarity" db:"semantic_similarity"`
	RougeL             *float64        `json:"rouge_l" db:"rouge_l"`
	TotalQuestions     *int            `json:"total_questions" db:"total_questions"`
	Status             string          `json:"status" db:"status"`
	Results            json.RawMessage `json:"results" db:"results"`
	CreatedAt          time.Time       `json:"created_at" db:"created_at"`
	CompletedAt        *time.Time      `json:"completed_at" db:"completed_at"`
}

type Job struct {
	ID          string          `json:"id" db:"id"`
	JobType     string          `json:"job_type" db:"job_type"`
	ProjectID   string          `json:"project_id" db:"project_id"`
	Payload     json.RawMessage `json:"payload" db:"payload"`
	Status      string          `json:"status" db:"status"`
	WorkerID    *string         `json:"worker_id" db:"worker_id"`
	Attempts    int             `json:"attempts" db:"attempts"`
	MaxAttempts int             `json:"max_attempts" db:"max_attempts"`
	Error        *string         `json:"error" db:"error"`
	ProgressData json.RawMessage `json:"progress_data" db:"progress_data"`
	CreatedAt    time.Time       `json:"created_at" db:"created_at"`
	ClaimedAt    *time.Time      `json:"claimed_at" db:"claimed_at"`
	CompletedAt  *time.Time      `json:"completed_at" db:"completed_at"`
}

type Worker struct {
	ID            string          `json:"id" db:"id"`
	UserID        string          `json:"user_id" db:"user_id"`
	Name          string          `json:"name" db:"name"`
	WorkerType    string          `json:"worker_type" db:"worker_type"`
	Status        string          `json:"status" db:"status"`
	LastHeartbeat time.Time       `json:"last_heartbeat" db:"last_heartbeat"`
	Capabilities  json.RawMessage `json:"capabilities" db:"capabilities"`
	CreatedAt     time.Time       `json:"created_at" db:"created_at"`
}

type ChatSession struct {
	ID               string    `json:"id" db:"id"`
	ProjectID        string    `json:"project_id" db:"project_id"`
	TrainingRunID    string    `json:"training_run_id" db:"training_run_id"`
	InferenceMode    string    `json:"inference_mode" db:"inference_mode"`
	HFEndpointName   *string   `json:"hf_endpoint_name" db:"hf_endpoint_name"`
	HFEndpointURL    *string   `json:"hf_endpoint_url" db:"hf_endpoint_url"`
	HFEndpointStatus *string   `json:"hf_endpoint_status" db:"hf_endpoint_status"`
	JobID            *string   `json:"job_id" db:"job_id"`
	Status           string    `json:"status" db:"status"`
	ErrorMessage     *string   `json:"error_message" db:"error_message"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}

type ChatMessage struct {
	ID        string    `json:"id" db:"id"`
	SessionID string    `json:"session_id" db:"session_id"`
	Role      string    `json:"role" db:"role"`
	Content   string    `json:"content" db:"content"`
	Status    string    `json:"status" db:"status"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}
