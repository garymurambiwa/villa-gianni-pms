
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashRouter, RouterProvider } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/theme-provider";
import Index from "./pages/Index";
import LoginPage from "./pages/LoginPage";
import Register from "./pages/Register";
import VerifyEmail from "./pages/VerifyEmail";
import ApprovalLink from "./pages/ApprovalLink";
import NotFound from "./pages/NotFound";
import { AppProvider } from "@/contexts/AppContext";
import { useAuth } from "@/context/AuthContext";
import ModuleAlias from "./pages/ModuleAlias";
import PasswordChangePage from "./pages/PasswordChange";
import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import VersionDisplay from "@/components/ui/VersionDisplay";
import { VirtualKeyboard } from "@/components/ui/VirtualKeyboard";
import { SettingsProvider } from "@/hooks/useSettings";

import { DEFAULT_ROOMS } from "@/data/defaultRooms";
import { resetToDefaultRooms } from "@/lib/roomService";

const queryClient = new QueryClient();

// MIGRATION: 2026-02-05 - Reset rooms
const MIGRATION_KEY = 'room_migration_2026_02_05_v2';
try {
  if (!localStorage.getItem(MIGRATION_KEY)) {
    console.log('Running room migration...');
    resetToDefaultRooms(DEFAULT_ROOMS);
    localStorage.setItem(MIGRATION_KEY, 'true');
    console.log('Room migration completed.');
  }
} catch (e) {
  console.error('Migration failed', e);
}

const router = createHashRouter([
  { path: "/", element: <Index /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <Register /> },
  { path: "/verify", element: <VerifyEmail /> },
  { path: "/password-change", element: <PasswordChangePage /> },
  { path: "/approve/:id/:token", element: <ApprovalLink /> },
  { path: "/night-audit", element: <ModuleAlias module="night-audit" /> },
  { path: "/maintenance", element: <ModuleAlias module="maintenance" /> },
  { path: "/maintenance/work-orders", element: <ModuleAlias module="maintenance" /> },
  { path: "/pos", element: <ModuleAlias module="pos" /> },
  { path: "/pos-settings", element: <ModuleAlias module="pos-settings" /> },
  { path: "/users", element: <ModuleAlias module="users" /> },
  { path: "/settings", element: <ModuleAlias module="settings" /> },
  { path: "*", element: <NotFound /> },
])

const App = () => (
  <ThemeProvider defaultTheme="light">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <SettingsProvider>
          <AppProvider>
            <ErrorBoundary>
              <RouterProvider router={router} future={{ v7_startTransition: true }} />
              <div
                className="fixed bottom-3 right-3 z-50"
                role="contentinfo"
              >
                <div className="px-2.5 py-1.5 rounded-md shadow-sm border bg-white/90 dark:bg-gray-900/90 border-gray-200 dark:border-gray-700">
                  <VersionDisplay className="text-gray-700 dark:text-gray-200" />
                </div>
              </div>
              <VirtualKeyboard />
            </ErrorBoundary>
          </AppProvider>
        </SettingsProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
