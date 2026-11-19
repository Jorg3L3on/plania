// 2.12 Pedir on Inicio: the words, the project and Pedir. PLA-87: it sends through the same route and modes as La
// corriente's Pedir bar (POST /company/projects/:slug/ask), so a request enters the idea flow (the PO, the tube) instead
// of becoming a bare Backlog ticket, and it keeps the bar's 2000-character limit instead of cutting at 200. The field
// grows with the words so a long request can be read before it goes.
import { SendIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { ASK_MAX, modesOf, type AskMode } from "@/lib/corriente";
import { askedLine } from "@/lib/edificio";
import { cn } from "@/lib/utils";
import { words } from "@/lib/i18n";
import { PEDIR_HOME } from "@/lib/pedir-home-words";

// PLA-I2-10: the ask modes in the screen's language (fixed for the page load).
const MODES = modesOf();

// The project Inicio's field asked for last, per device.
const LAST_PROJECT = "plania.pedir.project";
// The field grows up to this many pixels, then scrolls.
const MAX_FIELD_PX = 200;

const selectClass =
  "h-11 min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:text-sm dark:bg-input/30";

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
}

function writeLast(slug: string) {
  try {
    localStorage.setItem(LAST_PROJECT, slug);
  } catch {
    // Private mode: the picker just starts on the first project.
  }
}

/** Inicio's Pedir: the words, the project and how (Darle forma, Hacerlo ya, Preguntar), as in La corriente. */
export function PedirHome({ projects }: { projects: { slug: string; title: string }[] }) {
  const queryClient = useQueryClient();
  const w = words(PEDIR_HOME);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AskMode>("forma");
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState(() => readLast());
  const field = useRef<HTMLTextAreaElement>(null);
  const slug = projects.some((p) => p.slug === picked) ? picked! : (projects[0]?.slug ?? "");
  const project = projects.find((p) => p.slug === slug);

  // Grow with the words: one line when empty, up to MAX_FIELD_PX, then scroll.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_PX)}px`;
  }, [text]);

  async function send() {
    const said = text.trim();
    if (!said || !slug || sending) return;
    setSending(true);
    try {
      const r = await api.askProject(slug, { text: said, mode });
      toast(askedLine({ ...r, mode: r.mode ?? mode }, project?.title));
      setText("");
      setMode("forma");
      writeLast(slug);
      void queryClient.invalidateQueries({ queryKey: ["project", slug] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch {
      toast.error(w.sendFailed);
    } finally {
      setSending(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  // Enter sends, Shift+Enter starts a new line (as in a chat box).
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  if (!projects.length) return null;
  const near = text.length > ASK_MAX * 0.9;
  const line = MODES.find((m) => m.id === mode)?.line ?? "";
  return (
    <form onSubmit={submit} className="grid animate-rise gap-2 rounded-[20px] border bg-card/60 p-2.5" aria-label={w.form} data-pedir-home>
      <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
        <Textarea
          ref={field}
          aria-label={w.whatYouNeed}
          aria-describedby="pedir-home-line"
          value={text}
          maxLength={ASK_MAX}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={w.placeholder}
          className="min-h-11 basis-full resize-none py-2.5 text-base md:min-h-9 md:py-1.5 md:text-sm sm:basis-auto"
          enterKeyHint="send"
        />
        <select
          aria-label={w.project}
          value={slug}
          onChange={(e) => {
            setPicked(e.target.value);
            writeLast(e.target.value);
          }}
          className={cn(selectClass, "flex-1 sm:w-40 sm:flex-none")}
        >
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.title}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={!text.trim() || sending} className="h-11 shrink-0 px-4 md:h-9">
          <SendIcon aria-hidden /> {sending ? w.sending : mode === "pregunta" ? w.ask : w.send}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-xs text-muted-foreground">
        <span role="group" aria-label={w.how} className="inline-flex rounded-lg border p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id}
              data-mode={m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                "rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                mode === m.id ? "bg-secondary text-secondary-foreground" : "hover:text-foreground",
              )}
            >
              {m.name}
            </button>
          ))}
        </span>
        <span id="pedir-home-line" className="min-w-0 flex-1">
          {line}
        </span>
        {near && (
          <span aria-live="polite" className="tabular-nums">
            {text.length} / {ASK_MAX}
          </span>
        )}
      </div>
    </form>
  );
}
