import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { localTime } from "@/lib/time";

type CommentThreadProps = {
  slug: string;
  taskKey: string;
};

export const CommentThread = ({ slug, taskKey }: CommentThreadProps) => {
  const comments = useQuery({
    queryKey: ["comments", slug, taskKey],
    queryFn: () => api.comments(slug, taskKey),
  });

  if (comments.isPending) return <Skeleton className="h-16 rounded-xl" aria-hidden />;
  if (comments.isError || !comments.data) {
    return <p className="text-sm text-muted-foreground">No se pudieron cargar los comentarios.</p>;
  }

  const rows = comments.data.comments;

  return (
    <section className="grid gap-2" aria-label="Comentarios">
      <h3 className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Comentarios</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin comentarios.</p>
      ) : (
        <ol className="grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-1 rounded-xl bg-muted px-3 py-2">
              <p className="text-sm break-words whitespace-pre-wrap">{row.body}</p>
              <p className="text-xs text-muted-foreground">
                {row.author_agent} · {localTime(row.created_at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
