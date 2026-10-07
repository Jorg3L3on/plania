import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import "./index.css";

// Placeholder until the real screens land in phase 3.
function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">Plania</h1>
      <Button>shadcn/ui is wired</Button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
