export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

type Init = Omit<RequestInit, "body"> & { json?: unknown };

export async function api<T>(path: string, { json, headers, ...init }: Init = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(json !== undefined && { "content-type": "application/json" }), ...headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: "PUT", json });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = (err.body as { error?: { issues?: { message: string; path: (string | number)[] }[] } })?.error?.issues;
    if (issues?.length) return issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
