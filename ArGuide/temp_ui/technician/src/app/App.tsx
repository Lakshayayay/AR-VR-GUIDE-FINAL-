import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import PreDiagnosis from './components/PreDiagnosis';
import DiagnosisResult from './components/DiagnosisResult';
import LiveSession from './components/LiveSession';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/pre-diagnosis" element={<PreDiagnosis />} />
        <Route path="/diagnosis-result" element={<DiagnosisResult />} />
        <Route path="/live-session" element={<LiveSession />} />
      </Routes>
    </BrowserRouter>
  );
}
