import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { words } from "./i18n";
import { QUESTION_ANSWER_WORDS } from "./task-patch-words";

type SendInput = { answer: string; decision?: string };

// A question is one click, or a free-text answer. The screen session is the proof.
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
      const w = words(QUESTION_ANSWER_WORDS);
      toast(input.decision ? w.savedAsDecision : w.saved);
    },
    onError: () => toast.error(words(QUESTION_ANSWER_WORDS).failed),
    onSettled: refresh,
  });

  return { send };
};
