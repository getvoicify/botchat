import { createRoot } from "react-dom/client";
import { RoomList } from "./RoomList.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<RoomList />);
