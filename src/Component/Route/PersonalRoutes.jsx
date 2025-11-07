// src/Component/Route/PersonalRoutes.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { supabase } from "../../supabaseClient";

import Login from "../Auth/Login";
import Register from "../Auth/Register";
import Dashboard from "../Dashboard";

// ✅ Check if user is logged in
const isAuthenticated = () => !!localStorage.getItem("authToken");

// 🔒 Protected route (only logged-in users)
const ProtectedRoute = ({ element }) => {
  return isAuthenticated() ? element : <Navigate to="/login" replace />;
};

// 🚪 Public route (only guests)
const PublicRoute = ({ element }) => {
  return !isAuthenticated() ? element : <Navigate to="/dashboard" replace />;
};

// 📦 Dynamic route config
const routeConfig = [
  { path: "/login", element: <Login />, isProtected: false },
  { path: "/register", element: <Register />, isProtected: false },
  { path: "/dashboard", element: <Dashboard />, isProtected: true },
];

function PersonalRoutes() {
  // 🔁 Keep Supabase session in sync with localStorage
  useEffect(() => {
    // ✅ On auth change — store/remove token
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          localStorage.setItem("authToken", session.access_token);
        } else {
          localStorage.removeItem("authToken");
        }
      }
    );

    // ✅ On page refresh — restore active session
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        localStorage.setItem("authToken", data.session.access_token);
      } else {
        localStorage.removeItem("authToken");
      }
    };
    checkSession();

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <Routes>
      {routeConfig.map(({ path, element, isProtected }, index) => (
        <Route
          key={index}
          path={path}
          element={
            isProtected ? (
              <ProtectedRoute element={element} />
            ) : (
              <PublicRoute element={element} />
            )
          }
        />
      ))}

      {/* 🔁 Catch-all for unknown routes */}
      <Route
        path="*"
        element={
          isAuthenticated() ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}

export default PersonalRoutes;
