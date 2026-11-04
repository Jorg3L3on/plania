import { recapGlass } from "@/components/progress/recap-bits";

export const RecapEmpty = () => (
  <section className={`${recapGlass} px-6 py-10 text-center`}>
    <p className="text-5xl" aria-hidden>
      🌱
    </p>
    <h2 className="mt-3 font-display text-xl font-black tracking-tight">Todavía no hay cierres</h2>
    <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-[#a1a1aa]">
      Cuando un ticket llegue a hecho, o un PR se fusione, el recap se llena solo. Lo marcado como [PRUEBA] no cuenta.
    </p>
  </section>
);
