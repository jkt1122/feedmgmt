"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const signIn = trpc.auth.signIn.useMutation({
    onSuccess: () => router.push("/sources"),
    onError: (e) => setError(e.message),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-accent">
      <div className="w-full max-w-sm bg-card border border-border rounded-lg p-8 shadow-sm">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-foreground">FeedMgmt</h1>
          <p className="text-base text-muted-foreground mt-1">Sign in to your account</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            signIn.mutate({ email, password });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-semibold text-foreground">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-sm font-semibold text-foreground">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary text-primary-foreground font-semibold"
            disabled={signIn.isPending}
          >
            {signIn.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
