// PLA-I62-4: the reads a delivery needs (El Probador's pairs and QA's evidence), shared by Te toca and Entrega through
// the query cache. El Probador is read again every few seconds while its pictures are being taken.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const useProbadorRead = (slug: string, key: string | null) =>
  useQuery({
    queryKey: ["probador", slug, key],
    queryFn: () => api.probador(slug, key!),
    enabled: !!key,
    retry: 1,
    staleTime: 15_000,
    refetchInterval: (q) => (q.state.data?.state?.state === "tomando" ? 4000 : false),
  });

export const useQaRead = (slug: string, key: string | null) => useQuery({ queryKey: ["qa", slug, key], queryFn: () => api.qa(slug, key!), enabled: !!key, retry: 1, staleTime: 30_000 });
