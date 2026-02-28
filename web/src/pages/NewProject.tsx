import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function NewProject() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [purpose, setPurpose] = useState("");
  const [responseFormat, setResponseFormat] = useState("");
  const [selfAwareness, setSelfAwareness] = useState("");
  const [llmProvider, setLlmProvider] = useState("anthropic");

  const mutation = useMutation({
    mutationFn: () =>
      api.createProject({
        name,
        description,
        context: {
          purpose,
          response_format: responseFormat,
          self_awareness: selfAwareness,
          llm_provider: llmProvider,
        },
      }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
      navigate(`/projects/${project.id}`);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create project");
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-6 text-2xl font-mono font-bold">New Project</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono tracking-wide text-muted-foreground">
              Basics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Customer Support Bot"
                required
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this model for?"
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono tracking-wide text-muted-foreground">
              Model Context
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="llm-provider">LLM Provider</Label>
              <Select value={llmProvider} onValueChange={setLlmProvider}>
                <SelectTrigger id="llm-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                  <SelectItem value="mistral">Mistral</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Used for Q&A generation and LLM-as-judge benchmarking
              </p>
            </div>
            <div>
              <Label htmlFor="purpose">Model Purpose</Label>
              <Textarea
                id="purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Describe what the fine-tuned model should do. This guides Q&A generation from your data."
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="format">Expected Response Format</Label>
              <Textarea
                id="format"
                value={responseFormat}
                onChange={(e) => setResponseFormat(e.target.value)}
                placeholder="e.g. JSON, bullet points, conversational, technical..."
                rows={2}
              />
            </div>
            <div>
              <Label htmlFor="awareness">Self-Awareness Instructions</Label>
              <Textarea
                id="awareness"
                value={selfAwareness}
                onChange={(e) => setSelfAwareness(e.target.value)}
                placeholder='e.g. "You are a helpful assistant for Acme Corp..."'
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/")}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!name || mutation.isPending}
            className="bg-ecole-orange text-white hover:bg-ecole-orange-light"
          >
            {mutation.isPending ? "Creating..." : "Create Project"}
          </Button>
        </div>
      </form>
    </div>
  );
}
