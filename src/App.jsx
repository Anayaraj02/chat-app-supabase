// App.jsx
import PersonalRoutes from "./Component/Route/PersonalRoutes";
import { Toaster } from "react-hot-toast";

export default function App() {
  return (
    <>
      <Toaster
        position="top-center"
        reverseOrder={false}
        toastOptions={{
          duration: 2500,
          style: {
            borderRadius: "12px",
            background: "#1f2937", // neutral dark gray
            color: "#fff",
            padding: "12px 18px",
            fontSize: "15px",
            fontWeight: 500,
            boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
            transform: "translateY(0)",
            transition: "all 0.3s ease",
          },
          success: {
            icon: "✅",
            style: {
              background: "linear-gradient(135deg, #16a34a, #15803d)",
            },
          },
          error: {
            icon: "❌",
            style: {
              background: "linear-gradient(135deg, #dc2626, #b91c1c)",
            },
          },
          loading: {
            icon: "⏳",
            style: {
              background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
            },
          },
        }}
      />
      <PersonalRoutes />
    </>
  );
}
