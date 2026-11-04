import { useLayoutEffect } from "react";
import { useLocation, useNavigate } from "react-router";

// The list remembers its scroll. A detail opens at the top. Back returns to the same place.
export const useProgressScroll = () => {
  const location = useLocation();
  useLayoutEffect(() => {
    if (location.pathname !== "/progreso") {
      window.scrollTo(0, 0);
      return;
    }
    const saved = Number(sessionStorage.getItem("progreso-scroll") ?? "0");
    window.scrollTo(0, Number.isFinite(saved) ? saved : 0);
    return () => sessionStorage.setItem("progreso-scroll", String(window.scrollY));
  }, [location.key, location.pathname]);
};

export const DetailBack = ({ title, hint }: { title: string; hint: string }) => {
  const navigate = useNavigate();
  const handleBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/progreso");
  };
  return (
    <div className="mb-4 flex items-center gap-3">
      <button
        type="button"
        aria-label="Volver"
        onClick={handleBack}
        className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-lg"
      >
        ‹
      </button>
      <div className="min-w-0">
        <h1 className="truncate font-display text-2xl font-black tracking-tight">{title}</h1>
        <p className="text-[12px] font-semibold text-[#a1a1aa]">{hint}</p>
      </div>
    </div>
  );
};
