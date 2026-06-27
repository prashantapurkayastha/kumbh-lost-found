import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PublicApp from "./pages/PublicApp";
import VolunteerPanel from "./pages/VolunteerPanel";
import HelpDeskPanel from "./pages/HelpDeskPanel";
import "./styles/global.css";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"           element={<PublicApp />} />
        <Route path="/volunteer"  element={<VolunteerPanel />} />
        <Route path="/help-desk"  element={<HelpDeskPanel />} />
        <Route path="*"           element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
