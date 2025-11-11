// utils/customToasts.js
import toast from "react-hot-toast";

export const showSuccess = (message) => {
  toast.custom(
    () => (
      <motion.div
        initial={{ opacity: 0, x: 100 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 100 }}
        className="bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2"
      >
        {message}
      </motion.div>
    ),
    { duration: 2500 }
  );
};

export const showError = (message) => {
  toast.custom(
    () => (
      <motion.div
        initial={{ opacity: 0, x: 100 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 100 }}
        className="bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2"
      >
        ❌ {message}
      </motion.div>
    ),
    { duration: 3000 }
  );
};
