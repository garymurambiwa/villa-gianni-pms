
import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashRouter, RouterProvider } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/theme-provider";
import { AppProvider } from "@/contexts/AppContext";
import { SettingsProvider } from "@/hooks/useSettings";
import VersionDisplay from "@/components/ui/VersionDisplay";
import { VirtualKeyboard } from "@/components/ui/VirtualKeyboard";

// Lazy load pages for better performance
const Index = lazy(() => import("./pages/Index"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const Register = lazy(() => import("./pages/Register"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const ApprovalLink = lazy(() => import("./pages/ApprovalLink"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ModuleAlias = lazy(() => import("./pages/ModuleAlias"));
const PasswordChangePage = lazy(() => import("./pages/PasswordChange"));

import { DEFAULT_ROOMS } from "@/data/defaultRooms";
import { resetToDefaultRooms } from "@/lib/roomService";

const queryClient = new QueryClient();

// MIGRATION: 2026-02-05 - Reset rooms (LEGACY - DESTRUCTIVE)
// Removed permanently to prevent data loss during Git updates.
// Seeding is now handled safely in databaseInitializer.ts

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
  { path: "/availability-grid", element: <ModuleAlias module="availability-grid" /> },
  { path: "/users", element: <ModuleAlias module="users" /> },
  { path: "/settings", element: <ModuleAlias module="settings" /> },
  { path: "*", element: <NotFound /> },
])

// Loading fallback for lazy-loaded components
const LoadingFallback = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-10 h-10 border-4 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
      <p className="text-gray-400 text-sm font-medium">Loading...</p>
    </div>
  </div>
);

const App = () => (
  <ThemeProvider defaultTheme="light">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <SettingsProvider>
          <AppProvider>
            <ErrorBoundary>
              <Suspense fallback={<LoadingFallback />}>
                <RouterProvider router={router} future={{ v7_startTransition: true }} />
              </Suspense>
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
