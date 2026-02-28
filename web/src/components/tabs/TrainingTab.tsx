import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type TrainingRun } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Play, Upload, BarChart3, Cloud, Monitor } from "lucide-react";

const MODEL_OPTIONS = [
  { value: "mistralai/Ministral-3b-instruct", label: "Ministral 3B (Fast)" },
  { value: "mistralai/Ministral-8B-Instruct-2410", label: "Ministral 8B (Quality)" },
];

const COMPUTE_OPTIONS = [
  { value: "local", label: "Local GPU", icon: Monitor, description: "Train on your own GPU" },
  { value: "hf_jobs", label: "HF Jobs", icon: Cloud, description: "Train on HuggingFace infrastructure" },
];

export function TrainingTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [baseModel, setBaseModel] = useState(MODEL_OPTIONS[0].value);
  const [epochs, setEpochs] = useState("3");
  const [lr, setLr] = useState("0.0001");
  const [batchSize, setBatchSize] = useState("4");
  const [loraR, setLoraR] = useState("16");
  const [computeMode, setComputeMode] = useState("local");

  const { data: runs } = useQuery({
    queryKey: ["training-runs", projectId],
    queryFn: () => api.listTrainingRuns(projectId),
    refetchInterval: 5000,
  });

  const launchMutation = useMutation({
    mutationFn: () =>
      api.launchTraining(projectId, {
        base_model: baseModel,
        lora_config: {
          r: parseInt(loraR),
          lora_alpha: parseInt(loraR) * 2,
          lora_dropout: 0.05,
          target_modules: ["q_proj", "k_proj", "v_proj", "o_proj"],
        },
        training_config: {
          num_train_epochs: parseInt(epochs),
          per_device_train_batch_size: parseInt(batchSize),
          learning_rate: parseFloat(lr),
          warmup_ratio: 0.1,
          max_seq_length: 2048,
          gradient_accumulation_steps: 4,
          logging_steps: 10,
          bf16: true,
        },
        compute_mode: computeMode,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-runs", projectId] });
      toast.success(
        computeMode === "hf_jobs"
          ? "Training dispatched to HF Jobs"
          : "Training started"
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to start training");
    },
  });

  const uploadHFMutation = useMutation({
    mutationFn: (runId: string) => api.uploadToHF(projectId, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-runs", projectId] });
      toast.success("HuggingFace upload started");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to start HF upload");
    },
  });

  const benchmarkMutation = useMutation({
    mutationFn: (runId: string) => api.triggerBenchmark(projectId, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benchmarks", projectId] });
      toast.success("Benchmark started");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to start benchmark");
    },
  });

  const activeRun = runs?.find(
    (r: TrainingRun) => r.status === "training" || r.status === "queued" || r.status === "downloading"
  );

  return (
    <div className="space-y-6">
      {!activeRun && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
              Configure Training
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Compute Mode */}
            <div>
              <Label>Compute</Label>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                {COMPUTE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setComputeMode(opt.value)}
                    className={`flex items-center gap-3 border p-3 text-left text-sm transition-colors ${
                      computeMode === opt.value
                        ? "border-ecole-orange bg-ecole-orange/5"
                        : "border-input hover:border-muted-foreground"
                    }`}
                  >
                    <opt.icon className={`h-4 w-4 shrink-0 ${
                      computeMode === opt.value ? "text-ecole-orange" : "text-muted-foreground"
                    }`} />
                    <div>
                      <p className="font-medium font-mono text-xs">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Base Model */}
            <div>
              <Label>Base Model</Label>
              <select
                value={baseModel}
                onChange={(e) => setBaseModel(e.target.value)}
                className="flex h-9 w-full border border-input bg-background px-3 py-1 text-sm"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Epochs</Label>
                <Input value={epochs} onChange={(e) => setEpochs(e.target.value)} type="number" min="1" max="10" />
              </div>
              <div>
                <Label>Batch Size</Label>
                <Input value={batchSize} onChange={(e) => setBatchSize(e.target.value)} type="number" min="1" max="16" />
              </div>
              <div>
                <Label>Learning Rate</Label>
                <Input value={lr} onChange={(e) => setLr(e.target.value)} />
              </div>
              <div>
                <Label>LoRA Rank (r)</Label>
                <Input value={loraR} onChange={(e) => setLoraR(e.target.value)} type="number" min="4" max="64" />
              </div>
            </div>

            {computeMode === "hf_jobs" && (
              <p className="text-xs text-muted-foreground border border-border p-2">
                Requires HuggingFace Pro or Enterprise. Training will run on HF infrastructure
                ({baseModel.includes("8B") ? "A10G Large" : "A10G Small"} GPU). Configure your HF token in Settings.
              </p>
            )}

            <Button
              onClick={() => launchMutation.mutate()}
              disabled={launchMutation.isPending}
              className="w-full bg-ecole-orange text-white hover:bg-ecole-orange-light"
            >
              {computeMode === "hf_jobs" ? (
                <Cloud className="mr-2 h-4 w-4" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {launchMutation.isPending
                ? "Launching..."
                : computeMode === "hf_jobs"
                  ? "Launch on HF Jobs"
                  : "Start Training"}
            </Button>
          </CardContent>
        </Card>
      )}

      {runs && runs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            Training Runs
          </h3>
          {runs.map((run: TrainingRun) => (
            <Card key={run.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-mono font-medium">{run.base_model.split("/").pop()}</p>
                    {run.compute_mode === "hf_jobs" && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Cloud className="h-3 w-3" />
                        HF Jobs
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Epoch {run.current_epoch}/{run.total_epochs || "?"}
                    {run.train_loss != null && ` / Loss: ${run.train_loss.toFixed(4)}`}
                  </p>
                </div>
                <Badge
                  className={
                    run.status === "completed"
                      ? "bg-primary text-primary-foreground"
                      : run.status === "failed"
                        ? "bg-destructive text-white"
                        : run.status === "training"
                          ? "bg-ecole-orange text-white"
                          : ""
                  }
                >
                  {run.status}
                </Badge>
              </div>

              {run.status === "training" && (
                <div className="mt-3 h-1 w-full bg-muted">
                  <div
                    className="h-full bg-ecole-orange transition-all"
                    style={{
                      width: `${run.total_epochs ? (run.current_epoch / run.total_epochs) * 100 : 0}%`,
                    }}
                  />
                </div>
              )}

              {run.status === "failed" && run.error_message && (
                <p className="mt-2 text-xs text-destructive font-mono">{run.error_message}</p>
              )}

              {run.status === "completed" && (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => benchmarkMutation.mutate(run.id)}
                    disabled={benchmarkMutation.isPending}
                  >
                    <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
                    Benchmark
                  </Button>
                  {run.compute_mode !== "hf_jobs" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => uploadHFMutation.mutate(run.id)}
                      disabled={uploadHFMutation.isPending || !!run.hf_repo_id}
                    >
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      {run.hf_repo_id ? "Pushed to HF" : "Push to HF"}
                    </Button>
                  )}
                  {run.hf_repo_id && (
                    <a
                      href={`https://huggingface.co/${run.hf_repo_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-xs text-ecole-orange hover:underline font-mono"
                    >
                      {run.hf_repo_id}
                    </a>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
