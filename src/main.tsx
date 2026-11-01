import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "@/components/auth-gate";
import { ThemeProvider } from "@/components/theme";
import { Toaster } from "@/components/ui/sonner";
import { queryClient } from "@/lib/queries";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App";

// Installable PWA: new versions activate on the next launch without prompting.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <App />
        </AuthGate>
        <Toaster position="top-center" richColors closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
