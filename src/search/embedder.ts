// Where the vectors come from. Devva never embeds: whoever writes a vector must make the query's vector the
// same way, so the embedder's identity is declared on the lobe and kept beside every indexed text.
export type EmbedderIdentity = { embedder: string; revision: string; runtime: string };

export interface Embedder {
  readonly identity: EmbedderIdentity;
  embed(texts: string[]): Promise<number[][]>;
}

const BATCH = 64;

// The sextant service (devva-dock/sextant): a static multilingual model on CPU, 256 dimensions.
export function sextantEmbedder(url: string, identity: EmbedderIdentity = { embedder: "potion-multilingual-128M", revision: "sextant-i8", runtime: "cpu" }): Embedder {
  const endpoint = `${url.replace(/\/+$/, "")}/embed_batch`;
  return {
    identity,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texts: batch }) });
        if (!res.ok) throw new Error(`embedder answered ${res.status}`);
        const { vecs } = (await res.json()) as { vecs: number[][] };
        if (!Array.isArray(vecs) || vecs.length !== batch.length) throw new Error("embedder returned the wrong number of vectors");
        out.push(...vecs);
      }
      return out;
    },
  };
}
