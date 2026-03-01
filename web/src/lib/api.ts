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
  login: () => request<{ url?: string; dev_mode?: boolean }>("/auth/login"),
  logout: () => request("/auth/logout", { method: "POST" }),

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
  batchDeleteDatasetItems: (projectId: string, ids: string[]) =>
    request<{ deleted: number }>(`/projects/${projectId}/dataset/batch-delete`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  datasetStats: (projectId: string) =>
    request<DatasetStats>(`/projects/${projectId}/dataset/stats`),

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
  deleteTrainingRun: (projectId: string, runId: string) =>
    request(`/projects/${projectId}/training/${runId}`, { method: "DELETE" }),
  getTrainingLogs: (projectId: string, runId: string) =>
    request<{ logs: string }>(`/projects/${projectId}/training/${runId}/logs`),
  uploadToHF: (projectId: string, runId: string) =>
    request<Job>(`/projects/${projectId}/training/${runId}/upload-hf`, { method: "POST" }),

  // Benchmark
  triggerBenchmark: (projectId: string, data: TriggerBenchmarkInput) =>
    request(`/projects/${projectId}/benchmark`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listBenchmarks: (projectId: string) =>
    request<Benchmark[]>(`/projects/${projectId}/benchmark`),
  benchmarkJobStatus: (projectId: string) =>
    request<Job>(`/projects/${projectId}/benchmark/status`),

  // Jobs
  deleteJob: (projectId: string, jobId: string) =>
    request(`/projects/${projectId}/jobs/${jobId}`, { method: "DELETE" }),

  // Activity
  getActivity: () => request<Activity>("/activity"),

  // Settings
  getKeys: () => request<{ anthropic_key: string; mistral_key: string; hf_token: string }>("/settings/keys"),
  updateKeys: (data: { anthropic_key?: string; mistral_key?: string; hf_token?: string }) =>
    request("/settings/keys", { method: "PUT", body: JSON.stringify(data) }),

  // Chat
  createChatSession: (projectId: string, data: { training_run_id: string; inference_mode: string }) =>
    request<ChatSession>(`/projects/${projectId}/chat`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listChatSessions: (projectId: string) =>
    request<ChatSession[]>(`/projects/${projectId}/chat`),
  getChatSession: (projectId: string, sessionId: string) =>
    request<ChatSession>(`/projects/${projectId}/chat/${sessionId}`),
  deleteChatSession: (projectId: string, sessionId: string) =>
    request(`/projects/${projectId}/chat/${sessionId}`, { method: "DELETE" }),
  sendChatMessage: (projectId: string, sessionId: string, content: string) =>
    request<{ user_message: ChatMessage; assistant_message: ChatMessage }>(
      `/projects/${projectId}/chat/${sessionId}/messages`,
      { method: "POST", body: JSON.stringify({ content }) }
    ),
  listChatMessages: (projectId: string, sessionId: string) =>
    request<ChatMessage[]>(`/projects/${projectId}/chat/${sessionId}/messages`),
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
  hf_namespace: string | null;
  hf_job_id: string | null;
  hf_dataset_repo: string | null;
  status: string;
  current_epoch: number;
  total_epochs: number | null;
  train_loss: number | null;
  current_step: number;
  total_steps: number | null;
  grad_norm: number | null;
  learning_rate_current: number | null;
  output_model_path: string | null;
  hf_repo_id: string | null;
  trackio_url: string | null;
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
  hf_flavor?: string;
  hf_namespace?: string;
}

export interface TriggerBenchmarkInput {
  training_run_id: string;
  compute_mode?: string;
  hf_flavor?: string;
  hf_namespace?: string;
}

export interface Benchmark {
  id: string;
  training_run_id: string;
  project_id: string;
  model_type: string;
  epoch: number | null;
  accuracy: number | null;
  avg_score: number | null;
  semantic_similarity: number | null;
  rouge_l: number | null;
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
  error: string | null;
  progress_data: Record<string, unknown>;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
}

export interface DatasetStats {
  total: number;
  train_count: number;
  eval_count: number;
}

export interface ActivityTrainingRun {
  id: string;
  project_id: string;
  project_name: string;
  base_model: string;
  compute_mode: string;
  hf_job_id: string | null;
  status: string;
  current_epoch: number;
  total_epochs: number | null;
  train_loss: number | null;
  current_step: number;
  total_steps: number | null;
  grad_norm: number | null;
  learning_rate_current: number | null;
  hf_repo_id: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ActivityJob {
  id: string;
  job_type: string;
  project_id: string;
  project_name: string;
  status: string;
  error: string | null;
  progress_data: Record<string, unknown>;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
}

export interface Activity {
  training_runs: ActivityTrainingRun[];
  jobs: ActivityJob[];
}

export interface ChatSession {
  id: string;
  project_id: string;
  training_run_id: string;
  inference_mode: string;
  hf_endpoint_name: string | null;
  hf_endpoint_url: string | null;
  hf_endpoint_status: string | null;
  job_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  status: string;
  created_at: string;
}

export interface ChatStreamEvent {
  type: "delta" | "done" | "error" | "session_closed";
  message_id?: string;
  delta?: string;
  content?: string;
}

export function subscribeToChatStream(
  projectId: string,
  sessionId: string,
  onEvent: (event: ChatStreamEvent) => void,
): EventSource {
  const es = new EventSource(
    `${API_BASE}/projects/${projectId}/chat/${sessionId}/stream`,
  );
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as ChatStreamEvent;
      onEvent(data);
    } catch {
      // ignore parse errors
    }
  };
  es.onerror = () => {
    // EventSource will auto-reconnect
  };
  return es;
}
