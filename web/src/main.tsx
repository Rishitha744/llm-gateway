import React from "react";
import ReactDOM from "react-dom/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashRouter, createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import "./index.css";
import { ApiError } from "./lib/api";
import { DEMO_ONLY, SessionProvider, getSession, useSession } from "./lib/session";
import { ToastProvider } from "./components/ui";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Playground from "./pages/Playground";
import Requests from "./pages/Requests";
import Keys from "./pages/Keys";
import Quickstart from "./pages/Quickstart";
import Fleet from "./pages/ops/Fleet";
import Tenants from "./pages/ops/Tenants";
import AllJobs from "./pages/ops/AllJobs";
import DeadLetters from "./pages/ops/DeadLetters";
import SystemHealth from "./pages/ops/SystemHealth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
    },
  },
  queryCache: new QueryCache({
    onError: (err) => {
      // A revoked key or rotated admin token signs the user out of that console.
      if (err instanceof ApiError && err.status === 401 && !getSession().demo) {
        window.dispatchEvent(new CustomEvent("gw:unauthorized"));
      }
    },
  }),
});

function Guard({ need, children }: { need: "tenant" | "admin"; children: React.ReactNode }) {
  const s = useSession();
  if (need === "tenant" && !s.apiKey) return <Navigate to={s.adminToken ? "/ops" : "/login"} replace />;
  if (need === "admin" && !s.adminToken) return <Navigate to={s.apiKey ? "/" : "/login"} replace />;
  return <>{children}</>;
}

function Root() {
  const s = useSession();
  React.useEffect(() => {
    const h = () => s.signOut();
    window.addEventListener("gw:unauthorized", h);
    return () => window.removeEventListener("gw:unauthorized", h);
  }, [s]);
  // Never show one identity's cached data to another.
  React.useEffect(() => () => queryClient.clear(), [s.apiKey, s.adminToken, s.demo]);
  if (!s.apiKey && !s.adminToken) return <Login />;
  return <Layout />;
}

const routes = [
  { path: "/login", element: <LoginRoute /> },
  {
    path: "/",
    element: <Root />,
    children: [
      { index: true, element: <Guard need="tenant"><Overview /></Guard> },
      { path: "playground", element: <Guard need="tenant"><Playground /></Guard> },
      { path: "requests", element: <Guard need="tenant"><Requests /></Guard> },
      { path: "keys", element: <Guard need="tenant"><Keys /></Guard> },
      { path: "quickstart", element: <Guard need="tenant"><Quickstart /></Guard> },
      { path: "ops", element: <Guard need="admin"><Fleet /></Guard> },
      { path: "ops/tenants", element: <Guard need="admin"><Tenants /></Guard> },
      { path: "ops/jobs", element: <Guard need="admin"><AllJobs /></Guard> },
      { path: "ops/dlq", element: <Guard need="admin"><DeadLetters /></Guard> },
      { path: "ops/system", element: <Guard need="admin"><SystemHealth /></Guard> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

function LoginRoute() {
  const s = useSession();
  // ?add=1 lets a signed-in user connect the other console (tenant <-> operator).
  if (new URLSearchParams(window.location.search).has("add") && !s.demo) return <Login />;
  if (s.apiKey) return <Navigate to="/" replace />;
  if (s.adminToken) return <Navigate to="/ops" replace />;
  return <Login />;
}

// Static demo builds use hash routing so they work on any file host.
const router = DEMO_ONLY ? createHashRouter(routes) : createBrowserRouter(routes);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
