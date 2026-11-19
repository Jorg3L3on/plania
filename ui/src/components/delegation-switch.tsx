import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { DELEGATION } from "@/lib/delegation-words";

// The kill switch. Default on. Only this screen can change it; the bot has no tool for it.
export const DelegationSwitch = () => {
  const queryClient = useQueryClient();
  const w = words(DELEGATION);
  const state = useQuery({ queryKey: ["delegation"], queryFn: api.delegation });
  const save = useMutation({
    mutationFn: (enabled: boolean) => api.setDelegation(enabled),
    onSuccess: (data) => {
      queryClient.setQueryData(["delegation"], data);
      toast(data.enabled ? w.botOn : w.botOff);
    },
    onError: () => toast.error(w.changeFailed),
  });
  const enabled = state.data?.enabled ?? true;

  const handleCheckedChange = (checked: boolean) => {
    save.mutate(checked);
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
      <div className="grid gap-0.5">
        <Label htmlFor="delegation-enabled">{w.botOn}</Label>
        <p className="text-xs text-muted-foreground">{w.switchHint}</p>
      </div>
      <Switch
        id="delegation-enabled"
        checked={enabled}
        disabled={state.isPending || save.isPending}
        onCheckedChange={handleCheckedChange}
        aria-label={w.botOn}
      />
    </div>
  );
};
