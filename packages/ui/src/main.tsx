import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import App from "./App";
import { useReviewStore } from "./store/review";
// Only what the Mantine components we use need, not @mantine/core/styles.css.
// Its baseline reset would restyle <body>, which Tailwind's preflight already
// owns. The variables file is required: MantineProvider leaves out every
// variable that matches its defaults, expecting this file to supply them.
// Layered files, so our unlayered Tailwind styles win any overlap.
import "@mantine/core/styles/default-css-variables.layer.css";
import "@mantine/core/styles/Splitter.layer.css";
import "./index.css";

/** The store's theme drives Mantine too, so there is one dark/light switch. */
function Root() {
  const theme = useReviewStore((s) => s.theme);
  return (
    <MantineProvider forceColorScheme={theme}>
      <App />
    </MantineProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
