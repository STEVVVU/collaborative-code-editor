import { createRoot } from "react-dom/client";
import App from "./App";
import "@traceframe/react/styles.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
