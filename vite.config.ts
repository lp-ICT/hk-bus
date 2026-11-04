import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

process.env.VITE_APP_VERSION ||= new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(/\D/g, "").replace(/^(\d{4})(\d{2})(\d{2})(\d{4})$/, "$1.$2.$3-$4");

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [
    // React Compiler auto-memoizes components: skip hand-written useMemo/useCallback.
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5173,
    strictPort: true,
    hmr: false,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
