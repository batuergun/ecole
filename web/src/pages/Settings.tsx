import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Settings() {
  const queryClient = useQueryClient();
  const [anthropicKey, setAnthropicKey] = useState("");
  const [hfToken, setHfToken] = useState("");

  const { isLoading } = useQuery({
    queryKey: ["settings-keys"],
    queryFn: async () => {
      const keys = await api.getKeys();
      if (keys.anthropic_key) setAnthropicKey(keys.anthropic_key);
      if (keys.hf_token) setHfToken(keys.hf_token);
      return keys;
    },
  });

  const mutation = useMutation({
    mutationFn: () => {
      const data: { anthropic_key?: string; hf_token?: string } = {};
      // Only send keys that don't look masked
      if (anthropicKey && !anthropicKey.startsWith("****")) {
        data.anthropic_key = anthropicKey;
      }
      if (hfToken && !hfToken.startsWith("****")) {
        data.hf_token = hfToken;
      }
      return api.updateKeys(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-keys"] });
      toast.success("API keys saved");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to save keys");
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-6 text-2xl font-mono font-bold">Settings</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
              API Keys
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="space-y-4">
                <div className="h-16 animate-pulse bg-muted" />
                <div className="h-16 animate-pulse bg-muted" />
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="anthropic">Anthropic API Key</Label>
                  <Input
                    id="anthropic"
                    type="password"
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder="sk-ant-..."
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used for auto-harness (Q&A generation) and auto-benchmark
                  </p>
                </div>
                <div>
                  <Label htmlFor="hf">HuggingFace Token</Label>
                  <Input
                    id="hf"
                    type="password"
                    value={hfToken}
                    onChange={(e) => setHfToken(e.target.value)}
                    placeholder="hf_..."
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used for downloading models and uploading fine-tuned adapters
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={mutation.isPending || isLoading}
            className="bg-ecole-orange text-white hover:bg-ecole-orange-light"
          >
            {mutation.isPending ? "Saving..." : "Save Keys"}
          </Button>
        </div>
      </form>
    </div>
  );
}
