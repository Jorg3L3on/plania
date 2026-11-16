// PLA-I54-2: pictures on a request. ImageDrop takes a screenshot three ways (⌘V in the textarea it is given, drag and
// drop on the box, or the file picker), shows the chosen ones as thumbnails with a remove button, and hands the list
// to its parent (controlled: files + onChange). It uploads nothing: the parent sends them once the request exists
// (uploadPedidoImages in @/lib/api). Thumbs shows pictures already stored on a request, with an optional remove.
// Standalone on purpose: F5 (PLA-I54-5) wires it into Pedir and La ficha. Styles: the PLA-I54-2 block in index.css.
import { useEffect, useId, useRef, useState, type DragEvent, type RefObject } from "react";
import { PEDIDO_IMAGE_MAX, PEDIDO_IMAGE_MAX_BYTES } from "@/lib/api";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

// Which of the incoming files fit: right type, 5 MB or less, and room left. The first refusal reason is said once.
export function pickImages(incoming: readonly File[], current: readonly File[], max: number): { files: File[]; error: string | null } {
  const room = Math.max(0, max - current.length);
  const ok: File[] = [];
  let error: string | null = null;
  for (const f of incoming) {
    if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) {
      error ??= "Solo se aceptan imágenes PNG, JPEG o WebP.";
      continue;
    }
    if (f.size > PEDIDO_IMAGE_MAX_BYTES) {
      error ??= "Esa imagen pesa más de 5 MB.";
      continue;
    }
    if (current.includes(f) || ok.includes(f)) continue;
    if (ok.length >= room) {
      error ??= `Un pedido admite hasta ${PEDIDO_IMAGE_MAX} imágenes.`;
      continue;
    }
    ok.push(f);
  }
  return { files: [...current, ...ok], error };
}

// The files of a paste: a screenshot comes as a file item; text pastes have none and pass through.
export function pastedFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromFiles = Array.from(data.files ?? []);
  if (fromFiles.length) return fromFiles;
  return Array.from(data.items ?? [])
    .filter((i) => i.kind === "file")
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
}

export type ThumbImage = { id: string; url: string };

export function Thumbs({
  images,
  onRemove,
  removing,
  label = "Imágenes del pedido",
}: {
  images: readonly ThumbImage[];
  onRemove?: (id: string) => void;
  removing?: string | null;
  label?: string;
}) {
  if (images.length === 0) return null;
  return (
    <ul className="pdi-thumbs" aria-label={label} data-thumbs={images.length}>
      {images.map((img, i) => (
        <li key={img.id} className="pdi-thumb" data-removing={removing === img.id || undefined}>
          {img.url ? (
            <a href={img.url} target="_blank" rel="noreferrer" title="Abrir la imagen">
              <img src={img.url} alt={`Imagen ${i + 1}`} loading="lazy" decoding="async" />
            </a>
          ) : (
            <span className="pdi-thumb-blank" aria-label={`Imagen ${i + 1}`} />
          )}
          {onRemove ? (
            <button type="button" aria-label={`Quitar imagen ${i + 1}`} disabled={removing === img.id} onClick={() => onRemove(img.id)}>
              ×
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// One id per File for keys and object URLs, stable across renders.
const ids = new WeakMap<File, string>();
let nextId = 0;
const idOf = (f: File) => {
  let id = ids.get(f);
  if (!id) ids.set(f, (id = `f${++nextId}`));
  return id;
};

export function ImageDrop({
  files,
  onChange,
  textarea,
  stored = 0,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  // The request's text box: ⌘V of a screenshot there adds it here (a plain text paste is left alone).
  textarea?: RefObject<HTMLTextAreaElement | null>;
  // Pictures the request already has; they count toward the 6.
  stored?: number;
  disabled?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const max = Math.max(0, PEDIDO_IMAGE_MAX - stored);
  const full = files.length >= max;

  // Latest values for the paste listener, which is added once per textarea.
  const latest = useRef({ files, onChange, max, disabled });
  latest.current = { files, onChange, max, disabled };

  const add = (incoming: File[]) => {
    const { files: cur, onChange: set, max: m, disabled: off } = latest.current;
    if (off || incoming.length === 0) return;
    const r = pickImages(incoming, cur, m);
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
      if (got.length === 0) return;
      e.preventDefault();
      addRef.current(got);
    };
    el.addEventListener("paste", onPaste);
    return () => el.removeEventListener("paste", onPaste);
  }, [textarea]);

  // Object URLs for the thumbnails, freed when a file leaves or the box goes away.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of files) next[idOf(f)] = URL.createObjectURL(f);
    setUrls(next);
    return () => Object.values(next).forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const remove = (id: string) => {
    setError(null);
    onChange(files.filter((f) => idOf(f) !== id));
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    add(Array.from(e.dataTransfer?.files ?? []));
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = full ? "none" : "copy";
    setOver(true);
  };

  return (
    <div
      className="pdi-drop"
      data-image-drop
      data-over={over || undefined}
      data-disabled={disabled || undefined}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={onDrop}
    >
      <span className="pdi-hint">
        {full ? (
          `Ya tiene ${PEDIDO_IMAGE_MAX} imágenes, el máximo.`
        ) : (
          <>
            Pega una captura con <kbd>⌘V</kbd>, arrástrala aquí o{" "}
            <button type="button" className="pdi-pick" disabled={disabled} onClick={() => input.current?.click()} aria-controls={inputId}>
              elige un archivo
            </button>
            .
          </>
        )}
      </span>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        hidden
        tabIndex={-1}
        disabled={disabled || full}
        onChange={(e) => {
          add(Array.from(e.currentTarget.files ?? []));
          e.currentTarget.value = "";
        }}
      />
      <Thumbs images={files.map((f) => ({ id: idOf(f), url: urls[idOf(f)] ?? "" }))} onRemove={disabled ? undefined : remove} label="Imágenes elegidas" />
      {error ? (
        <span className="pdi-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
