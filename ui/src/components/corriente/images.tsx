// PLA-I62-5: pictures on a request, as the building's ImageDrop (PLA-I54-2): ⌘V of a screenshot in the request's
// text, drag and drop on the box, or Elegir imágenes; PNG, JPEG or WebP up to 5 MB, six per request. It uploads
// nothing: the page sends them once the request has its key (uploadPedidoImages).
import { useEffect, useId, useRef, useState, type DragEvent, type RefObject } from "react";
import { PEDIDO_IMAGE_MAX, PEDIDO_IMAGE_MAX_BYTES } from "@/lib/api";
import { words } from "@/lib/i18n";
import { IMAGES_WORDS } from "@/lib/images-words";
import { Btn } from "./parts";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export function pickImages(incoming: readonly File[], current: readonly File[], max: number): { files: File[]; error: string | null } {
  const w = words(IMAGES_WORDS);
  const room = Math.max(0, max - current.length);
  const ok: File[] = [];
  let error: string | null = null;
  for (const f of incoming) {
    if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) {
      error ??= w.badType;
      continue;
    }
    if (f.size > PEDIDO_IMAGE_MAX_BYTES) {
      error ??= w.tooBig;
      continue;
    }
    if (current.includes(f) || ok.includes(f)) continue;
    if (ok.length >= room) {
      error ??= w.tooMany(PEDIDO_IMAGE_MAX);
      continue;
    }
    ok.push(f);
  }
  return { files: [...current, ...ok], error };
}

export function pastedFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromFiles = Array.from(data.files ?? []);
  if (fromFiles.length) return fromFiles;
  return Array.from(data.items ?? [])
    .filter((i) => i.kind === "file")
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
}

export const Images = ({ files, onChange, textarea, count, disabled }: { files: File[]; onChange: (f: File[]) => void; textarea?: RefObject<HTMLTextAreaElement | null>; count?: string; disabled?: boolean }) => {
  const w = words(IMAGES_WORDS);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const latest = useRef({ files, onChange, disabled });
  latest.current = { files, onChange, disabled };
  const add = (incoming: File[]) => {
    const { files: cur, onChange: set, disabled: off } = latest.current;
    if (off || !incoming.length) return;
    const r = pickImages(incoming, cur, PEDIDO_IMAGE_MAX);
    setError(r.error);
    if (r.files.length !== cur.length) set(r.files);
  };
  const addRef = useRef(add);
  addRef.current = add;
  useEffect(() => {
    const el = textarea?.current;
    if (!el) return;
    const onPaste = (e: ClipboardEvent) => {
      const got = pastedFiles(e.clipboardData);
      if (!got.length) return;
      e.preventDefault();
      addRef.current(got);
    };
    el.addEventListener("paste", onPaste);
    return () => el.removeEventListener("paste", onPaste);
  }, [textarea]);
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    add(Array.from(e.dataTransfer?.files ?? []));
  };
  return (
    <div
      className="cor-images"
      data-over={over || undefined}
      data-images={files.length}
      onDragOver={(e) => {
        if (disabled || !Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <rect x="2" y="3" width="12" height="10" rx="2" />
        <circle cx="6" cy="7" r="1.2" />
        <path d="m3 12 3.5-3 2.5 2 2-1.5L13 12" />
      </svg>
      {files.length > 0 ? (
        <ul className="cor-thumbs" aria-label={w.list}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {urls[i] && <img src={urls[i]} alt={w.image(i + 1)} />}
              <button type="button" aria-label={w.remove(i + 1)} onClick={() => onChange(files.filter((x) => x !== f))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="cor-images-hint">{w.hint}</span>
      )}
      {error && (
        <span className="cor-state bad" role="alert">
          {error}
        </span>
      )}
      {count && <span className="cor-cap">{count}</span>}
      <input ref={input} id={id} type="file" accept={IMAGE_TYPES.join(",")} multiple hidden onChange={(e) => (add(Array.from(e.target.files ?? [])), (e.target.value = ""))} data-control="imagenes-input" />
      <Btn kind="secondary" onClick={() => input.current?.click()} disabled={disabled || files.length >= PEDIDO_IMAGE_MAX} data-control="elegir-imagenes">
        {w.choose}
      </Btn>
    </div>
  );
};
