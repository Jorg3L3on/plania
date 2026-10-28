import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";

type SendInput = { answer: string; decision?: string };

// A question, including a human_only gate, is one click. The screen session is the proof.
export const useQuestionAnswer = (slug: string, questionId: string) => {
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["project", slug] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["inbox"] });
  };

  const send = useMutation({
    mutationFn: (input: SendInput) => api.answer(slug, questionId, input.answer, input.decision),
    onSuccess: (_data, input) => {
      toast(input.decision ? "Respuesta guardada como decisión" : "Respuesta guardada");
    },
    onError: () => toast.error("No se pudo guardar la respuesta."),
    onSettled: refresh,
  });

  return { send };
};
