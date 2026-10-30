import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

// The kill switch. Default on. Only this screen can change it; the bot has no tool for it.
export const DelegationSwitch = () => {
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["delegation"], queryFn: api.delegation });
  const save = useMutation({
    mutationFn: (enabled: boolean) => api.setDelegation(enabled),
    onSuccess: (data) => {
      queryClient.setQueryData(["delegation"], data);
      toast(data.enabled ? "El bot puede responder por ti" : "Solo respondes tú, en esta pantalla");
    },
    onError: () => toast.error("No se pudo cambiar."),
  });
  const enabled = state.data?.enabled ?? true;

  const handleCheckedChange = (checked: boolean) => {
    save.mutate(checked);
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
      <div className="grid gap-0.5">
        <Label htmlFor="delegation-enabled">El bot puede responder por ti</Label>
        <p className="text-xs text-muted-foreground">
          Encendido por defecto. Apagado, una pregunta solo para ti o una aprobación solo se responde aquí.
        </p>
      </div>
      <Switch
        id="delegation-enabled"
        checked={enabled}
        disabled={state.isPending || save.isPending}
        onCheckedChange={handleCheckedChange}
        aria-label="El bot puede responder por ti"
      />
    </div>
  );
};
