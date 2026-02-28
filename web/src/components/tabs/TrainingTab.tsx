import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, type TrainingRun } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Play, Upload, BarChart3, Cloud, Monitor, Cpu, Trash2, Settings } from "lucide-react";

const MODEL_OPTIONS = [
  { value: "mistralai/Ministral-3-3B-Reasoning-2512", label: "Ministral 3B (Fast)" },
  { value: "mistralai/Ministral-3-8B-Reasoning-2512", label: "Ministral 8B (Quality)" },
];

const COMPUTE_OPTIONS = [
  { value: "local", label: "Local GPU", icon: Monitor, description: "Train on your own GPU" },
  { value: "hf_jobs", label: "HF Jobs", icon: Cloud, description: "Train on HuggingFace infrastructure" },
];

const HF_FLAVOR_OPTIONS = [
  { value: "a10g-small", label: "A10G Small", vram: "24 GB", description: "1x NVIDIA A10G" },
  { value: "a10g-large", label: "A10G Large", vram: "24 GB", description: "1x A10G + more CPU/RAM" },
  { value: "l4x1", label: "L4 x1", vram: "24 GB", description: "1x NVIDIA L4" },
  { value: "l4x4", label: "L4 x4", vram: "96 GB", description: "4x NVIDIA L4" },
  { value: "a100-large", label: "A100 Large", vram: "80 GB", description: "1x NVIDIA A100" },
];

const RECOMMENDED_FLAVORS: Record<string, string> = {
  "mistralai/Ministral-3-3B-Reasoning-2512": "a10g-small",
  "mistralai/Ministral-3-8B-Reasoning-2512": "a10g-large",
};

export function TrainingTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [baseModel, setBaseModel] = useState(MODEL_OPTIONS[0].value);
  const [epochs, setEpochs] = useState("3");
  const [lr, setLr] = useState("0.0001");
  const [batchSize, setBatchSize] = useState("4");
  const [loraR, setLoraR] = useState("16");
  const [computeMode, setComputeMode] = useState("local");
  const [hfFlavor, setHfFlavor] = useState(RECOMMENDED_FLAVORS[MODEL_OPTIONS[0].value] || "a10g-small");
  const [hfNamespace, setHfNamespace] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

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
        ...(computeMode === "hf_jobs" ? { hf_flavor: hfFlavor } : {}),
        ...(computeMode === "hf_jobs" && hfNamespace ? { hf_namespace: hfNamespace } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-runs", projectId] });
      setShowConfirmDialog(false);
      toast.success(
        computeMode === "hf_jobs"
          ? "Training dispatched to HF Jobs"
          : "Training started"
      );
    },
    onError: (err: Error) => {
      setShowConfirmDialog(false);
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

  const deleteMutation = useMutation({
    mutationFn: (runId: string) => api.deleteTrainingRun(projectId, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-runs", projectId] });
      toast.success("Training run deleted");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete training run");
    },
  });

  const activeRun = runs?.find(
    (r: TrainingRun) => r.status === "training" || r.status === "queued" || r.status === "downloading"
  );

  const handleLaunch = () => {
    if (activeRun) {
      setShowConfirmDialog(true);
    } else {
      launchMutation.mutate();
    }
  };

  return (
    <div className="space-y-6">
      {/* Training Runs */}
      {runs && runs.length > 0 && (
        <div className="space-y-3">
          {runs.map((run: TrainingRun) => {
            const isFailed = run.status === "failed";
            const isHfTokenError = isFailed && run.error_message?.toLowerCase().includes("huggingface token");

            return (
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
                  <div className="flex items-center gap-2">
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
                    {(isFailed || run.status === "completed") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(run.id)}
                        className="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
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

                {isFailed && run.error_message && (
                  <div className="mt-2">
                    <p className="text-xs text-destructive font-mono">{run.error_message}</p>
                    {isHfTokenError && (
                      <button
                        onClick={() => navigate("/settings")}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs text-ecole-orange hover:underline font-mono"
                      >
                        <Settings className="h-3 w-3" />
                        Go to Settings to add your HF token
                      </button>
                    )}
                  </div>
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
            );
          })}
        </div>
      )}

      {/* Config Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono tracking-wide text-muted-foreground">
            {runs && runs.length > 0 ? "New Training Run" : "Configure Training"}
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
              onChange={(e) => {
                const model = e.target.value;
                setBaseModel(model);
                if (RECOMMENDED_FLAVORS[model]) setHfFlavor(RECOMMENDED_FLAVORS[model]);
              }}
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
            <>
              {/* Hardware */}
              <div>
                <Label className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5" />
                  Hardware
                </Label>
                <div className="grid grid-cols-1 gap-1.5 mt-1.5">
                  {HF_FLAVOR_OPTIONS.map((opt) => {
                    const isRecommended = RECOMMENDED_FLAVORS[baseModel] === opt.value;
                    const isSelected = hfFlavor === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setHfFlavor(opt.value)}
                        className={`flex items-center justify-between border p-2.5 text-left text-sm transition-colors ${
                          isSelected
                            ? "border-ecole-orange bg-ecole-orange/5"
                            : "border-input hover:border-muted-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium">{opt.label}</span>
                          {isRecommended && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-ecole-orange/10 text-ecole-orange border border-ecole-orange/20">
                              Recommended
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{opt.description}</span>
                          <span className="font-mono">{opt.vram}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label>Organization Namespace</Label>
                <Input
                  value={hfNamespace}
                  onChange={(e) => setHfNamespace(e.target.value)}
                  placeholder="Leave empty for personal account"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Org name to run the job under (billing & ownership). Leave empty to use your personal account.
                </p>
              </div>
            </>
          )}

          <Button
            onClick={handleLaunch}
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

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Training already in progress</DialogTitle>
            <DialogDescription>
              You have a training run that is currently {activeRun?.status}. Starting a new
              run will not cancel the existing one. Both will run simultaneously.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button
              className="bg-ecole-orange text-white hover:bg-ecole-orange-light"
              onClick={() => launchMutation.mutate()}
              disabled={launchMutation.isPending}
            >
              {launchMutation.isPending ? "Launching..." : "Launch Anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
