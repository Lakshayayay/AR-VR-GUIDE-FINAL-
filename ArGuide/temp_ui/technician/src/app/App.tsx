import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import LiveSession from './components/LiveSession';
import PreDiagnosis from './components/PreDiagnosis';
import DiagnosisResult from './components/DiagnosisResult';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/live-session" element={<LiveSession />} />
        <Route path="/pre-diagnosis" element={<PreDiagnosis />} />
        <Route path="/diagnosis-result" element={<DiagnosisResult />} />
      </Routes>
    </Router>
  );
}