import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LanguageProvider } from "./context/LanguageContext";
import PublicApp from "./pages/PublicApp";
import VolunteerPanel from "./pages/VolunteerPanel";
import HelpDeskPanel from "./pages/HelpDeskPanel";
import MissingRegistry from "./pages/MissingRegistry";
import "./styles/global.css";

export default function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"           element={<PublicApp />} />
          <Route path="/volunteer"  element={<VolunteerPanel />} />
          <Route path="/help-desk"  element={<HelpDeskPanel />} />
          <Route path="/registry"   element={<MissingRegistry />} />
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </LanguageProvider>
  );
}
