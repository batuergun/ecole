const API_BASE = "/api";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include",
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return null as T;
  return res.json();
}

export const api = {
  // Auth
  me: () => request<User>("/auth/me"),

  // Projects
  listProjects: () => request<Project[]>("/projects"),
  createProject: (data: CreateProjectInput) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  updateProject: (id: string, data: UpdateProjectInput) =>
    request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProject: (id: string) =>
    request(`/projects/${id}`, { method: "DELETE" }),

  // Uploads
  listUploads: (projectId: string) =>
    request<Upload[]>(`/projects/${projectId}/uploads`),
  uploadFile: async (projectId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/projects/${projectId}/uploads`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json() as Promise<Upload>;
  },
  deleteUpload: (projectId: string, uploadId: string) =>
    request(`/projects/${projectId}/uploads/${uploadId}`, { method: "DELETE" }),

  // Harness
  triggerHarness: (projectId: string) =>
    request(`/projects/${projectId}/harness`, { method: "POST" }),
  harnessStatus: (projectId: string) =>
    request<Job>(`/projects/${projectId}/harness/status`),

  // Dataset
  listDataset: (projectId: string, limit = 50, offset = 0) =>
    request<{ items: DatasetItem[]; total: number }>(
      `/projects/${projectId}/dataset?limit=${limit}&offset=${offset}`
    ),
  updateDatasetItem: (projectId: string, itemId: string, data: { question: string; answer: string }) =>
    request<DatasetItem>(`/projects/${projectId}/dataset/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteDatasetItem: (projectId: string, itemId: string) =>
    request(`/projects/${projectId}/dataset/${itemId}`, { method: "DELETE" }),

  // Training
  launchTraining: (projectId: string, data: LaunchTrainingInput) =>
    request<TrainingRun>(`/projects/${projectId}/training`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listTrainingRuns: (projectId: string) =>
    request<TrainingRun[]>(`/projects/${projectId}/training`),
  getTrainingRun: (projectId: string, runId: string) =>
    request<TrainingRun>(`/projects/${projectId}/training/${runId}`),
  uploadToHF: (projectId: string, runId: string) =>
    request<Job>(`/projects/${projectId}/training/${runId}/upload-hf`, { method: "POST" }),

  // Benchmark
  triggerBenchmark: (projectId: string, trainingRunId: string) =>
    request(`/projects/${projectId}/benchmark`, {
      method: "POST",
      body: JSON.stringify({ training_run_id: trainingRunId }),
    }),
  listBenchmarks: (projectId: string) =>
    request<Benchmark[]>(`/projects/${projectId}/benchmark`),

  // Settings
  getKeys: () => request<{ anthropic_key: string; hf_token: string }>("/settings/keys"),
  updateKeys: (data: { anthropic_key?: string; hf_token?: string }) =>
    request("/settings/keys", { method: "PUT", body: JSON.stringify(data) }),
};

// Types
export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string;
  context: Record<string, string>;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  context?: Record<string, string>;
}

export type UpdateProjectInput = CreateProjectInput;

export interface Upload {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  page_count: number | null;
  status: string;
  created_at: string;
}

export interface DatasetItem {
  id: string;
  project_id: string;
  chunk_id: string | null;
  question: string;
  answer: string;
  is_eval: boolean;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrainingRun {
  id: string;
  project_id: string;
  base_model: string;
  lora_config: Record<string, unknown>;
  training_config: Record<string, unknown>;
  compute_mode: string;
  status: string;
  current_epoch: number;
  total_epochs: number | null;
  train_loss: number | null;
  output_model_path: string | null;
  hf_repo_id: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface LaunchTrainingInput {
  base_model?: string;
  lora_config?: Record<string, unknown>;
  training_config?: Record<string, unknown>;
  compute_mode?: string;
}

export interface Benchmark {
  id: string;
  training_run_id: string;
  project_id: string;
  model_type: string;
  epoch: number | null;
  accuracy: number | null;
  avg_score: number | null;
  total_questions: number;
  status: string;
  results: unknown[];
  created_at: string;
}

export interface Job {
  id: string;
  job_type: string;
  project_id: string;
  status: string;
  created_at: string;
}
