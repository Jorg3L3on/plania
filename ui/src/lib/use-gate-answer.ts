import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";

export function gateMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "No se pudo guardar la respuesta.";
  if (error.code === "GATE_CODE_NOT_ENROLLED") return "Aún no hay código enrolado. Sigue el paso de la sección Compuertas.";
  if (error.code === "GATE_CODE_INVALID") return "Ese código no vale, o ya se usó en esta ventana. Mira el de ahora en la app.";
  if (error.code === "GATE_CODE_EXPIRED") return "Pasaron dos minutos. Elige la opción otra vez.";
  if (error.code === "GATE_CHALLENGE_LOCKED") return "Tres intentos fallidos. Elige la opción otra vez.";
  return "No se pudo guardar la respuesta.";
}

type SendInput = { answer: string; decision?: string; nonce?: string; code?: string };

// Ordinary questions, including a human_only question that is not a gate, send the answer at once.
// A gate opens a challenge for the chosen option, then sends the authenticator code with that challenge.
export function useQuestionAnswer(slug: string, questionId: string, needsCode: boolean) {
  const queryClient = useQueryClient();
  const [challenge, setChallenge] = useState<{ option: string; nonce: string } | null>(null);
  const [code, setCode] = useState("");
  const enrolled = useQuery({ queryKey: ["gate"], queryFn: api.gate, enabled: needsCode, staleTime: 15_000 });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["project", slug] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    void queryClient.invalidateQueries({ queryKey: ["gate"] });
  };

  const send = useMutation({
    mutationFn: (input: SendInput) =>
      api.answer(slug, questionId, input.answer, input.decision, input.nonce ? { nonce: input.nonce, code: input.code ?? "" } : undefined),
    onSuccess: (_data, input) => {
      toast(input.decision ? "Respuesta guardada como decisión" : "Respuesta guardada");
      setChallenge(null);
      setCode("");
    },
    onError: (error) => toast.error(gateMessage(error)),
    onSettled: refresh,
  });

  const begin = useMutation({
    mutationFn: (option: string) => api.createChallenge(slug, questionId, option),
    onSuccess: (out, option) => {
      setChallenge({ option, nonce: out.nonce });
      setCode("");
    },
    onError: (error) => toast.error(gateMessage(error)),
  });

  return {
    enrolled: enrolled.data?.enrolled,
    challenge,
    code,
    setCode,
    send,
    begin,
    clear: () => {
      setChallenge(null);
      setCode("");
    },
  };
}
