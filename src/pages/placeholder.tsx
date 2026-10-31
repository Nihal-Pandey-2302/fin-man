import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <h1 className="font-heading text-2xl font-semibold">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Not built yet</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
