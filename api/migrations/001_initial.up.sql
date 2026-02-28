CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (synced from WorkOS)
CREATE TABLE users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workos_user_id        TEXT UNIQUE NOT NULL,
    email                 TEXT NOT NULL,
    name                  TEXT,
    anthropic_api_key_enc BYTEA,
    mistral_api_key_enc   BYTEA,
    hf_api_token_enc      BYTEA,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Projects
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    context     JSONB DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'created'
                CHECK (status IN ('created','processing','dataset_ready','training','trained','benchmarked')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_projects_user ON projects(user_id);

-- Uploaded files
CREATE TABLE uploads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  BIGINT NOT NULL,
    storage_key TEXT NOT NULL,
    page_count  INT,
    status      TEXT NOT NULL DEFAULT 'uploaded'
                CHECK (status IN ('uploaded','processing','processed','error')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_uploads_project ON uploads(project_id);

-- Chunks extracted from uploads
CREATE TABLE chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id   UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content     TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_chunks_upload ON chunks(upload_id);

-- Generated Q&A pairs (training dataset)
CREATE TABLE dataset_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chunk_id    UUID REFERENCES chunks(id) ON DELETE SET NULL,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    is_eval     BOOLEAN NOT NULL DEFAULT FALSE,
    is_edited   BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dataset_project ON dataset_items(project_id);
CREATE INDEX idx_dataset_eval ON dataset_items(project_id, is_eval);

-- Training runs
CREATE TABLE training_runs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    base_model            TEXT NOT NULL DEFAULT 'mistralai/Ministral-3b-instruct',
    lora_config           JSONB NOT NULL DEFAULT '{"r":16,"lora_alpha":32,"lora_dropout":0.05,"target_modules":["q_proj","k_proj","v_proj","o_proj"],"task_type":"CAUSAL_LM"}',
    training_config       JSONB NOT NULL DEFAULT '{"num_train_epochs":3,"per_device_train_batch_size":4,"learning_rate":1e-4,"warmup_ratio":0.1,"max_seq_length":2048,"gradient_accumulation_steps":4,"logging_steps":10,"bf16":true}',
    compute_mode          TEXT NOT NULL DEFAULT 'local'
                          CHECK (compute_mode IN ('local','hf_jobs')),
    hf_flavor             TEXT,
    hf_namespace          TEXT,
    hf_job_id             TEXT,
    worker_id             UUID,
    status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','queued','downloading','training','completed','failed','cancelled')),
    current_epoch         INT DEFAULT 0,
    total_epochs          INT,
    train_loss            FLOAT,
    current_step          INT DEFAULT 0,
    total_steps           INT,
    grad_norm             FLOAT,
    learning_rate_current FLOAT,
    logs                  TEXT DEFAULT '',
    output_model_path     TEXT,
    hf_repo_id            TEXT,
    error_message         TEXT,
    started_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_training_project ON training_runs(project_id);

-- Benchmark runs
CREATE TABLE benchmarks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    training_run_id     UUID NOT NULL REFERENCES training_runs(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    model_type          TEXT NOT NULL CHECK (model_type IN ('base','finetuned','teacher')),
    epoch               INT,
    accuracy            FLOAT,
    avg_score           FLOAT,
    semantic_similarity FLOAT,
    rouge_l             FLOAT,
    total_questions     INT,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','completed','failed')),
    results             JSONB DEFAULT '[]',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);
CREATE INDEX idx_benchmarks_training ON benchmarks(training_run_id);

-- Job queue
CREATE TABLE jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type      TEXT NOT NULL CHECK (job_type IN ('harness','training','benchmark')),
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    payload       JSONB NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','claimed','running','completed','failed')),
    worker_id     TEXT,
    attempts      INT NOT NULL DEFAULT 0,
    max_attempts  INT NOT NULL DEFAULT 3,
    error         TEXT,
    progress_data JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ
);
CREATE INDEX idx_jobs_status ON jobs(status, created_at);

-- Workers
CREATE TABLE workers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id),
    name           TEXT NOT NULL DEFAULT 'local',
    worker_type    TEXT NOT NULL DEFAULT 'local'
                   CHECK (worker_type IN ('local','hf_jobs')),
    status         TEXT NOT NULL DEFAULT 'online'
                   CHECK (status IN ('online','busy','offline')),
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    capabilities   JSONB DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
