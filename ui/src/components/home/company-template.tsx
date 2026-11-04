import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

const fieldClass = "h-11 text-base md:h-9 md:text-sm";

export const CompanyTemplate = () => {
  const id = useId();
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const ready = slug.trim().length > 0 && name.trim().length > 0 && owner.trim().length > 0;

  const create = useMutation({
    mutationFn: api.createCompany,
    onSuccess: (result) => {
      toast(result.created ? `Compañía ${result.project} creada` : `El slug ${result.project} ya estaba`);
      setSlug("");
      setName("");
      setOwner("");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? "Revisa el slug, el nombre y el bot." : "No se pudo crear la compañía."),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || create.isPending) return;
    create.mutate({ slug: slug.trim(), name: name.trim(), owner_bot_name: owner.trim() });
  };

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-3 rounded-[20px] border bg-card/60 px-4 py-4 sm:px-5">
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="font-display text-lg font-bold tracking-tight">
          Nueva compañía
        </h2>
        <p className="text-sm text-muted-foreground">Un proyecto, un bot product owner y el Playbook. El mismo slug se queda como está.</p>
      </div>
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-slug`} className="text-xs font-medium text-muted-foreground">
            Slug
          </label>
          <Input
            id={`${id}-slug`}
            value={slug}
            maxLength={56}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="acme"
            className={fieldClass}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-name`} className="text-xs font-medium text-muted-foreground">
            Nombre
          </label>
          <Input id={`${id}-name`} value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="Acme" className={fieldClass} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-owner`} className="text-xs font-medium text-muted-foreground">
            Bot dueño
          </label>
          <Input
            id={`${id}-owner`}
            value={owner}
            maxLength={60}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="Owner Bot"
            className={fieldClass}
          />
        </div>
        <Button type="submit" disabled={!ready || create.isPending} className="h-11 md:h-9">
          Crear
        </Button>
      </form>
    </section>
  );
};
