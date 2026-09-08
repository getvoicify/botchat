import { createRoot } from "react-dom/client";
import { Room } from "./Room.tsx";
import { RoomList } from "./RoomList.tsx";
import "./styles.css";

const match = location.pathname.match(/^\/rooms\/([^/]+)$/);
createRoot(document.getElementById("root")!).render(
  match ? <Room roomId={decodeURIComponent(match[1]!)} /> : <RoomList />,
);
