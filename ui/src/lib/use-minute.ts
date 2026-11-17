// Clocks for Compañía (they lived in pages/ceo.tsx with the building).
import { useEffect, useState } from "react";

/** "hace 5 min" keeps moving without a refetch. */
export const useMinute = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
};
