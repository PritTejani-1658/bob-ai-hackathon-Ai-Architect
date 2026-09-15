import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layouts/MainLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import CommandCenter from './pages/CommandCenter';
import Vessels from './pages/Vessels';
import BerthsCranes from './pages/BerthsCranes';
import Plan72Hour from './pages/Plan72Hour';
import WhatIf from './pages/WhatIf';
import Analytics from './pages/Analytics';
import Copilot from './pages/Copilot';
import Settings from './pages/Settings';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Navigate to="/command-center" replace />} />
            <Route path="command-center" element={<CommandCenter />} />
            <Route path="vessels" element={<Vessels />} />
            <Route path="berths-cranes" element={<BerthsCranes />} />
            <Route path="72-hour-plan" element={<Plan72Hour />} />
            <Route path="what-if" element={<WhatIf />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="copilot" element={<Copilot />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
