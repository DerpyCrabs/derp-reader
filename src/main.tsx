import { render } from "solid-js/web";
import "pdfjs-dist/web/pdf_viewer.css";
import App from "./App";
import "./styles.css";

render(() => <App />, document.getElementById("root") as HTMLElement);
