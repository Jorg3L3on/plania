// PLA-I67-4: an agent's references on «Oficio» (sketch PLA-IDEA31 frame 7). In the drawing they enter as threads
// under the skills, each row with its thumbnail and how often the seat opened it (thicker: opened more; dashed: the
// owner said avoid; a stub: switched off). The side panel lists them and takes a pasted link, a dropped or chosen
// image or PDF; the reference card shows the reduced image and what it costs a run, the owner's note, follow or avoid,
// when and for whom, and how many deliveries opened it. The teach bar's «Una referencia» mode joins these later.
import { useRef, useState } from "react";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { words } from "@/lib/i18n";
import { REFERENCE_UI_WORDS } from "@/lib/references-words";
import { REFERENCE_ACCEPT, droppedFiles, pastedUrl, precheck, refusal, refRows, type Reference, type ReferenceFields } from "@/lib/references";
import { refsApi } from "@/lib/references-api";
import { dayLabel, threadWidth } from "@/lib/oficio";
import { Btn, Label, Opt, Switch, useSingleFlight } from "./parts";

export const REF_ROW = 44;
const LABEL_W = 268;

const refsKey = (slug: string, agent: string) => ["refs", slug, agent];

// ---- The rows and threads in the drawing

const Thumb = ({ r }: { r: Reference }) =>
  r.kind === "image" && r.file_url ? (
    <img className="ofi-ref-thumb" src={r.file_url} alt="" loading="lazy" decoding="async" />
  ) : (
    <span className={`ofi-ref-thumb ${r.kind}${r.fetch_status === "failed" ? " failed" : ""}`} aria-hidden>
      {r.kind === "link" ? "↗" : "PDF"}
    </span>
  );

export function refsHeight(rows: number, more: number): number {
  return rows + more === 0 ? 0 : 22 + (rows + (more ? 1 : 0)) * REF_ROW;
}

export const RefThreads = ({
  refs,
  room,
  top,
  W,
  H,
  thread,
  pick,
  onPick,
  onMore,
  seat,
}: {
  refs: Reference[];
  room: number;
  top: number;
  W: number;
  H: number;
  thread: (y: number) => string;
  pick: string | null;
  onPick: (id: string) => void;
  onMore: () => void;
  seat: string;
}) => {
  const w = words(REFERENCE_UI_WORDS);
  const { shown, more } = refRows(refs, room);
  if (shown.length === 0 && more === 0) return null;
  const maxOpened = Math.max(0, ...refs.map((r) => r.uses.deliveries_opened));
  const y = (i: number) => top + 22 + i * REF_ROW + REF_ROW / 2;
  return (
    <>
      <svg className="ofi-svg" width={W} height={H} aria-hidden>
        {shown.map((r, i) =>
          r.state === "off" ? (
            <path key={r.id} d={`M ${LABEL_W + 12} ${y(i)} L ${LABEL_W + 82} ${y(i)} M ${LABEL_W + 86} ${y(i) - 5} L ${LABEL_W + 86} ${y(i) + 5}`} className="ofi-thread-off" />
          ) : (
            <path key={r.id} d={thread(y(i))} className={`ofi-ref-thread${r.stance === "avoid" ? " avoid" : ""}`} style={{ strokeWidth: threadWidth(r.uses.deliveries_opened, maxOpened) }} />
          ),
        )}
      </svg>
      <Label as="p" className="ofi-ref-group" style={{ top }}>
        {w.group}
      </Label>
      <ul className="ofi-ref-rows" aria-label={w.rows(seat)} style={{ top: top + 22 }}>
        {shown.map((r) => {
          const cap =
            r.state === "off" ? w.off : r.fetch_status === "failed" ? w.failed : r.uses.deliveries_carried === 0 ? w.neverCarried : w.openedIn(r.uses.deliveries_opened, r.uses.deliveries_carried);
          return (
            <li key={r.id}>
              <button
                type="button"
                className={`ofi-ref-row${r.state === "off" ? " off" : ""}${r.fetch_status === "failed" ? " failed" : ""}`}
                aria-pressed={pick === r.id}
                aria-label={w.openedInLong(r.title, r.uses.deliveries_opened, r.uses.deliveries_carried)}
                onClick={() => onPick(r.id)}
                data-ref={r.id}
              >
                <Thumb r={r} />
                <span className="ofi-row-name">{r.title}</span>
                <span className={`cor-cap${r.fetch_status === "failed" ? " ofi-ref-bad" : ""}`}>{cap}</span>
              </button>
            </li>
          );
        })}
        {more > 0 && (
          <li>
            <button type="button" className="ofi-ref-row more" onClick={onMore} data-control="mas-referencias">
              <span className="ofi-row-name cor-muted">{w.more(more)}</span>
            </button>
          </li>
        )}
      </ul>
    </>
  );
};

// ---- Adding: a link, a file, paste and drop

export function useRefUpload(slug: string, agent: string, onAdded: (r: Reference) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (f: File) => {
      const local = precheck(f);
      const w = words(REFERENCE_UI_WORDS);
      if (local) throw new Error(local === "big" ? `${w.fileRefused}: 5 MB` : w.fileRefused);
      return refsApi.addFile(slug, agent, f, f.name);
    },
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: refsKey(slug, agent) });
      onAdded(r);
    },
  });
}
export type RefUpload = UseMutationResult<Reference, Error, File>;

/** Drag a file anywhere on the page: the page says where it goes, and the drop uploads it. */
export function useRefDrop(onFile: (f: File) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  return {
    over,
    handlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (hasFiles(e)) e.preventDefault();
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        const files = droppedFiles(e.dataTransfer?.files);
        depth.current = 0;
        setOver(false);
        if (files.length === 0) return;
        e.preventDefault();
        onFile(files[0]!);
      },
    },
  };
}

export const RefPanel = ({
  slug,
  agent,
  seat,
  refs,
  upload,
  onOpen,
  onClose,
}: {
  slug: string;
  agent: string;
  seat: string;
  refs: Reference[];
  upload: RefUpload;
  onOpen: (id: string) => void;
  onClose: () => void;
}) => {
  const w = words(REFERENCE_UI_WORDS);
  const client = useQueryClient();
  const [link, setLink] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const addLink = useMutation({
    mutationFn: useSingleFlight((u: string) => refsApi.addLink(slug, agent, u)),
    onSuccess: (r) => {
      setLink("");
      void client.invalidateQueries({ queryKey: refsKey(slug, agent) });
      onOpen(r.reference.id);
    },
  });
  const onPaste = (e: React.ClipboardEvent) => {
    const files = droppedFiles(e.clipboardData?.files);
    if (files.length) {
      e.preventDefault();
      upload.mutate(files[0]!);
      return;
    }
    const u = pastedUrl(e.clipboardData?.getData("text") ?? "");
    if (u && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      setLink(u);
    }
  };
  const fileErr = upload.isError ? (upload.error instanceof Error && !("status" in upload.error) ? upload.error.message : refusal(upload.error, w.notNow)) : null;
  const linkErr = addLink.isError ? refusal(addLink.error, w.notNow) : null;
  return (
    <section className="cor-card ofi-side-card ofi-refs" aria-label={w.panel(seat)} onPaste={onPaste} data-refs-open>
      <div className="ofi-side-head">
        <Label as="h3">{w.panel(seat)}</Label>
        <Btn kind="quiet" small onClick={onClose} aria-label={w.close} data-control="cerrar-referencias">
          ×
        </Btn>
      </div>
      <p className="cor-cap ofi-shelf-hint">{w.panelHint(seat)}</p>
      <form
        className="ofi-ref-link"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) addLink.mutate(link.trim());
        }}
      >
        <label className="cor-label" htmlFor={`ref-link-${agent}`}>
          {w.linkLabel}
        </label>
        <div className="ofi-ref-link-row">
          <input id={`ref-link-${agent}`} className="cor-input" type="url" inputMode="url" placeholder={w.linkPlaceholder} value={link} onChange={(e) => setLink(e.target.value)} data-control="enlace" />
          <Btn kind="secondary" type="submit" disabled={!link.trim() || addLink.isPending} data-control="guardar-enlace">
            {addLink.isPending ? w.reading : w.saveLink}
          </Btn>
        </div>
        {linkErr && (
          <p className="cor-state bad" role="alert" data-state="link-refused">
            {linkErr}
          </p>
        )}
      </form>
      <button type="button" className="ofi-ref-drop" onClick={() => file.current?.click()} disabled={upload.isPending} data-control="elegir-archivo">
        <span>{upload.isPending ? w.uploading : w.drop}</span>
        <span className="cor-cap">{w.dropHint}</span>
      </button>
      <input
        ref={file}
        type="file"
        accept={REFERENCE_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = "";
        }}
      />
      {fileErr && (
        <p className="cor-state bad" role="alert" data-state="file-refused">
          {w.fileRefused}: {fileErr}
        </p>
      )}
      <ul className="ofi-ref-list">
        {refs.length === 0 && <li className="cor-muted cor-cap">{w.none}</li>}
        {refs.map((r) => (
          <li key={r.id}>
            <button type="button" className="ofi-ref-row" onClick={() => onOpen(r.id)} data-ref-item={r.id}>
              <Thumb r={r} />
              <span className="ofi-row-name">{r.title}</span>
              <span className={`cor-cap${r.fetch_status === "failed" ? " ofi-ref-bad" : ""}`}>{r.state === "off" ? w.off : r.fetch_status === "failed" ? w.failed : w.openedIn(r.uses.deliveries_opened, r.uses.deliveries_carried)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

// ---- The card

export const RefCard = ({ slug, agent, seat, r, now, timeZone, onClose }: { slug: string; agent: string; seat: string; r: Reference; now: number; timeZone?: string; onClose: () => void }) => {
  const w = words(REFERENCE_UI_WORDS);
  const client = useQueryClient();
  const [draft, setDraft] = useState<ReferenceFields>({ note: r.note, stance: r.stance, applies: r.applies, scope: r.scope });
  const [sure, setSure] = useState(false);
  const changed = draft.note !== r.note || draft.stance !== r.stance || draft.applies !== r.applies || draft.scope !== r.scope;
  const refresh = () => void client.invalidateQueries({ queryKey: refsKey(slug, agent) });
  const save = useMutation({ mutationFn: useSingleFlight((f: ReferenceFields) => refsApi.update(slug, agent, r.id, f)), onSuccess: refresh });
  const retry = useMutation({ mutationFn: useSingleFlight(() => refsApi.retry(slug, agent, r.id)), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: useSingleFlight(() => refsApi.remove(slug, agent, r.id)),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const ro = !r.mine;
  const status = save.isPending ? w.saving : save.isError ? refusal(save.error, w.notNow) : save.isSuccess && !changed ? w.saved : null;
  return (
    <section className="cor-card ofi-side-card ofi-ref-card" aria-label={r.title} data-ref-card={r.id}>
      <div className="ofi-side-head">
        <Label as="p">{w.card(w.kind[r.kind] ?? r.kind, dayLabel(r.created_at, now, timeZone))}</Label>
        <Btn kind="quiet" small onClick={onClose} aria-label={w.close} data-control="cerrar-referencia">
          ×
        </Btn>
      </div>
      <div className="ofi-ref-scroll">
        <h3 className="ofi-ref-title">{r.title}</h3>
        {r.kind === "image" && r.file_url && (
          <figure className="ofi-ref-figure">
            <img src={r.file_url} alt={r.title} decoding="async" />
            {r.width && r.height && <figcaption className="cor-cap">{w.size(r.width, r.height, r.tokens)}</figcaption>}
          </figure>
        )}
        {r.kind === "image" && r.width && r.height && Math.max(r.width, r.height) > 2576 && <p className="cor-cap">{w.notReduced}</p>}
        {r.kind === "file" && (
          <p className="ofi-ref-file">
            <span className="ofi-ref-thumb file" aria-hidden>
              PDF
            </span>
            <span className="cor-cap">{w.pages(r.pages)}</span>
          </p>
        )}
        {r.kind === "link" && (
          <div className="ofi-ref-linkinfo">
            {r.url && (
              <a className="cor-inline ofi-ref-url" href={r.url} target="_blank" rel="noreferrer noopener" data-control="abrir-enlace">
                {r.host ?? r.url}
              </a>
            )}
            {r.fetch_status === "failed" ? (
              <div className="ofi-ref-failed" role="status" data-state="link-failed">
                <p className="cor-state bad">{w.linkFailed}</p>
                <p className="cor-cap">{r.fetch_error?.message}</p>
                {r.mine && (
                  <Btn kind="secondary" small onClick={() => retry.mutate()} disabled={retry.isPending} data-control="probar-otra-vez">
                    {retry.isPending ? w.reading : w.retry}
                  </Btn>
                )}
              </div>
            ) : (
              r.snapshot_at && <p className="cor-cap">{r.mime ? w.size(r.width ?? 0, r.height ?? 0, r.tokens) : w.snapshot(dayLabel(r.snapshot_at, now, timeZone), r.snapshot_chars)}</p>
            )}
          </div>
        )}
        {ro ? (
          <>
            {r.note && <blockquote className="ofi-quote">{r.note}</blockquote>}
            <p className="cor-cap">{w.shared}</p>
          </>
        ) : (
          <>
            <label className="cor-label" htmlFor={`ref-note-${r.id}`}>
              {w.why}
            </label>
            <textarea id={`ref-note-${r.id}`} className="cor-textarea ofi-ref-note" rows={2} maxLength={600} placeholder={w.whyPlaceholder(seat)} value={draft.note ?? ""} onChange={(e) => setDraft({ ...draft, note: e.target.value })} data-control="nota" />
            <div className="ofi-ref-two">
              <div>
                <Label as="p">{w.isFor}</Label>
                <div className="ofi-ref-opts" role="group" aria-label={w.isFor}>
                  <Opt on={draft.stance === "follow"} onClick={() => setDraft({ ...draft, stance: "follow" })} data-control="seguir">
                    {w.follow}
                  </Opt>
                  <Opt on={draft.stance === "avoid"} onClick={() => setDraft({ ...draft, stance: "avoid" })} data-control="evitar">
                    {w.avoid}
                  </Opt>
                </div>
              </div>
              <div>
                <label className="cor-label" htmlFor={`ref-when-${r.id}`}>
                  {w.when}
                </label>
                <select id={`ref-when-${r.id}`} className="cor-select" value={draft.applies} onChange={(e) => setDraft({ ...draft, applies: e.target.value as Reference["applies"] })} data-control="cuando">
                  <option value="always">{w.always}</option>
                  <option value="on_topic">{w.onTopic}</option>
                </select>
              </div>
            </div>
            <label className="cor-label" htmlFor={`ref-scope-${r.id}`}>
              {w.forWhom}
            </label>
            <select id={`ref-scope-${r.id}`} className="cor-select" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as Reference["scope"] })} data-control="para-quien">
              <option value="agent">{w.onlySeat(seat)}</option>
              <option value="project">{w.wholeTeam}</option>
            </select>
            <Switch on={r.state === "on"} label={w.carried} disabled={save.isPending} onChange={(on) => save.mutate({ state: on ? "on" : "off" })} data-control="la-lleva" />
          </>
        )}
        <p className="cor-cap ofi-ref-uses" data-uses={`${r.uses.deliveries_opened}/${r.uses.deliveries_carried}`}>
          {r.uses.deliveries_carried === 0 ? w.noUses : w.uses(r.uses.deliveries_opened, r.uses.deliveries_carried)}
        </p>
      </div>
      {!ro && (
        <div className="ofi-ref-foot">
          <Btn kind="primary" onClick={() => save.mutate(draft)} disabled={!changed || save.isPending} data-control="guardar-referencia">
            {save.isPending ? w.saving : w.save}
          </Btn>
          <Btn kind="link" className="ofi-ref-remove" onClick={() => (sure ? remove.mutate() : setSure(true))} disabled={remove.isPending} data-control="quitar-referencia">
            {remove.isPending ? w.removing : sure ? w.removeSure : w.remove}
          </Btn>
        </div>
      )}
      {(status || remove.isError || retry.isError) && (
        <p className="cor-cap" role="status">
          {status ?? refusal(remove.error ?? retry.error, w.notNow)}
        </p>
      )}
    </section>
  );
};
