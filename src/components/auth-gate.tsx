import { LockKeyhole } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, post } from "@/lib/api";
import { queryClient, useSession, type Session } from "@/lib/queries";

/** Shows the app only with a session; otherwise the password screen (see worker/auth.ts). */
export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isPending, isError, refetch } = useSession();
  if (isPending) return <Skeleton className="m-6 h-40 rounded-xl" />;
  if (isError) {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">Can't reach fintrack right now.</p>
        <Button variant="outline" onClick={() => refetch()}>
          Try again
        </Button>
      </Centered>
    );
  }
  if (!data.authenticated) return <LoginScreen configured={data.configured} />;
  return children;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-4">{children}</div>;
}

function LoginScreen({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/auth/login", { password });
      // Drop anything cached while signed out, then show the app.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
      queryClient.setQueryData<Session>(["session"], { configured: true, authenticated: true });
    } catch (err) {
      const code = err instanceof ApiError ? err.status : 0;
      setError(code === 401 ? "Wrong password." : code === 429 ? "Too many attempts. Try again in 15 minutes." : "Couldn't sign in. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <LockKeyhole className="size-5" />
          </div>
          <CardTitle>fintrack</CardTitle>
          <CardDescription>{configured ? "Enter your password." : "Login isn't set up: add APP_PASSWORD and SESSION_SECRET as Worker secrets."}</CardDescription>
        </CardHeader>
        {configured && (
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              {/* A username field lets password managers save and fill the login. */}
              <input type="text" name="username" autoComplete="username" value="owner" readOnly hidden />
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="h-11 md:h-9"
                aria-invalid={!!error}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="h-11 w-full md:h-9" disabled={!password || busy}>
                Sign in
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
    </Centered>
  );
}
