export function SectionPlaceholder({
  title,
  accentClass,
}: {
  title: string;
  accentClass: string;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-400">{title}</p>
      <h1 className={`mt-2 text-2xl font-semibold ${accentClass}`}>{title}</h1>
      <p className="mt-2 text-sm text-zinc-400">
        This screen is ready in the app shell and protected by auth.
      </p>
    </section>
  );
}
