import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Login() {
  const loginMutation = useMutation({
    mutationFn: api.login,
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url;
      } else if (data?.dev_mode) {
        // Dev mode: already authenticated, go to dashboard
        window.location.href = "/";
      }
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="font-mono text-3xl font-bold tracking-tighter text-foreground">
                ecole
              </span>
              <span className="inline-block h-3 w-3 bg-ecole-orange" />
            </div>
            <p className="text-sm text-muted-foreground">
              Fine-tune models for your use case
            </p>
          </div>

          <Button
            onClick={() => loginMutation.mutate()}
            disabled={loginMutation.isPending}
            className="w-full bg-ecole-orange text-white hover:bg-ecole-orange-light"
          >
            {loginMutation.isPending ? "Redirecting..." : "Sign in"}
          </Button>

          {loginMutation.isError && (
            <p className="mt-3 text-xs text-destructive">
              Failed to sign in. Please try again.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
