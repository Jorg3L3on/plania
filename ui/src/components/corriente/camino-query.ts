// PLA-I68-2: Camino's read, shared by the door and the bar's count. While discovery runs in the background the read
// says checking: true, and the query looks again every 3 s until it is done.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const caminoKey = (slug: string) => ["camino", slug] as const;

export const useCamino = (slug: string) =>
  useQuery({
    queryKey: caminoKey(slug),
    queryFn: () => api.camino(slug),
    staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.checking ? 3_000 : false),
  });
