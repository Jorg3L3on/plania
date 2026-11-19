// PLA-I2-9: on Máquinas of Plania itself, the migrations agents wrote and the live database has not applied.
// Renders nothing for any other project or when nothing is pending. Words in lib/migraciones-propias.ts.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { migracionesView, type AgentMigrations } from "@/lib/migraciones-propias";

export const MigracionesPropiasView = ({ data }: { data: AgentMigrations | null | undefined }) => {
  const v = migracionesView(data);
  if (!v) return null;
  return (
    <section className="cor-card" data-migraciones-propias style={{ marginBottom: 16 }}>
      <h3 className="cor-h3">{v.title}</h3>
      <p className="cor-text">{v.lead}</p>
      <ul>
        {v.lines.map((l) => (
          <li key={l.key} className="cor-text">
            {l.text}
          </li>
        ))}
      </ul>
      <p className="cor-cap">{v.how}</p>
    </section>
  );
};

export const MigracionesPropias = ({ slug }: { slug: string }) => {
  const q = useQuery({ queryKey: ["migraciones-propias", slug], queryFn: () => api.selfMigrations(slug), staleTime: 30_000, refetchInterval: 60_000 });
  return <MigracionesPropiasView data={q.data} />;
};
