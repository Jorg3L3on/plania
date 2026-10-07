import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isUnauthorized } from "@/lib/api";
import { App } from "./App";
import "./index.css";

// Any 401 means the session expired: re-check it so the guard redirects to /login.
// Not for the session query itself, or its own 401 would re-trigger it forever.
const onError = (error: unknown) => {
  if (isUnauthorized(error)) void queryClient.invalidateQueries({ queryKey: ["session"] });
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => query.queryKey[0] !== "session" && onError(error) }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: { retry: (count, error) => !isUnauthorized(error) && count < 2, refetchOnWindowFocus: true },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {/* Layout animations follow the system's reduced-motion setting. */}
          <MotionConfig reducedMotion="user">
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </MotionConfig>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
