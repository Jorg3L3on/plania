import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { TOKENS } from "@/lib/tokens-words";
import { localTime } from "@/lib/time";
import { cn } from "@/lib/utils";

// Per-agent tokens: issued here, shown once, revoked here. Each one names the agent and machine it
// belongs to and what it may do (read, write, ops: env and sequences).

const SCOPES = ["read", "write", "ops"] as const;

export function TokensPage() {
  const w = words(TOKENS);
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: api.tokens });
  const [name, setName] = useState("");
  const [agent, setAgent] = useState("");
  const [machine, setMachine] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set(["read", "write"]));
  const [secret, setSecret] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createToken({ name: name.trim(), agent: agent.trim(), machine: machine.trim() || undefined, scopes: [...scopes] }),
    onSuccess: (out) => {
      setSecret(out.secret);
      setName("");
      setAgent("");
      setMachine("");
      void queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: () => toast.error(w.createFailed),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeToken(id, "revocado en pantalla"),
    onSuccess: () => {
      toast(w.revoked);
      void queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: () => toast.error(w.revokeFailed),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() && agent.trim() && scopes.size) create.mutate();
  }

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <Kicker>{w.kicker}</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{w.title}</h1>
        <p className="text-muted-foreground">{w.lead}</p>
      </header>

      <Card>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="tk-name">{w.name}</Label>
              <Input id="tk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="mac-claude" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tk-agent">{w.agent}</Label>
              <Input id="tk-agent" value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Claude Code" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tk-machine">{w.machine}</Label>
              <Input id="tk-machine" value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="laptop" />
            </div>
            <Button type="submit" disabled={!name.trim() || !agent.trim() || !scopes.size || create.isPending}>{w.create}</Button>
            <div className="flex flex-wrap gap-3 sm:col-span-4">
              {SCOPES.map((s) => (
                <label key={s} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scopes.has(s)}
                    onChange={() =>
                      setScopes((prev) => {
                        const next = new Set(prev);
                        if (next.has(s)) next.delete(s);
                        else next.add(s);
                        return next;
                      })
                    }
                    className="size-4 accent-foreground"
                  />
                  <span className="font-mono">{s}</span>
                  <span className="text-xs text-muted-foreground">{w.scope[s]}</span>
                </label>
              ))}
            </div>
          </form>
          {secret && (
            <div className="mt-4 grid gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p>{w.copyNow}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 basis-full overflow-x-auto rounded sm:flex-1 sm:basis-auto bg-muted px-2 py-1 font-mono text-xs">{secret}</code>
                <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(secret).then(() => toast(w.copied))}>
                  <CopyIcon /> {w.copy}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>{w.done}</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {tokens.isPending ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : tokens.isError ? (
        <p className="text-sm text-destructive">{w.loadFailed}</p>
      ) : tokens.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{w.none}</p>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {tokens.data.map((t) => (
            <div key={t.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm", t.revoked_at && "text-muted-foreground")}>
              <span className="font-medium">{t.name}</span>
              <span className="font-mono text-xs">{t.prefix}…</span>
              <span>{t.agent}{t.machine ? ` @ ${t.machine}` : ""}</span>
              <span className="font-mono text-xs">{t.scopes.join(" ")}</span>
              <span className="text-xs">{t.last_used_at ? w.used(localTime(t.last_used_at)) : w.unused}</span>
              {t.revoked_at ? (
                <span className="text-xs line-through">{w.revokedAt(localTime(t.revoked_at))}</span>
              ) : (
                <Button size="sm" variant="ghost" className="ml-auto" disabled={revoke.isPending} onClick={() => revoke.mutate(t.id)}>{w.revoke}</Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
