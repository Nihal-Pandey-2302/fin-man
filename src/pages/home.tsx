import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Health = { ok: boolean; db: boolean };

export function HomePage() {
  const [health, setHealth] = useState<Health | "error" | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setHealth, () => setHealth("error"));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-2xl font-semibold">Today</h1>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Safe to spend today</CardTitle>
            <CardDescription>Dashboard arrives in Phase 1.</CardDescription>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-9 w-32" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Backend</CardTitle>
            <CardDescription>Worker + D1 status</CardDescription>
          </CardHeader>
          <CardContent>
            {health === null ? (
              <Skeleton className="h-6 w-24" />
            ) : health === "error" ? (
              <Badge variant="destructive">API unreachable</Badge>
            ) : (
              <div className="flex gap-2">
                <Badge variant={health.ok ? "default" : "destructive"}>API {health.ok ? "up" : "down"}</Badge>
                <Badge variant={health.db ? "default" : "destructive"}>D1 {health.db ? "up" : "down"}</Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
