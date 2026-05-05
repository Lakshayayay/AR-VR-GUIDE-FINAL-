import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, ArrowLeft, Wrench, Video } from 'lucide-react';

export default function DiagnosisResult() {
  const location = useLocation();
  const navigate = useNavigate();
  const { diagnosis, photo } = location.state || {};

  if (!diagnosis) {
    return (
      <div className="min-h-screen bg-[#111] text-white flex flex-col items-center justify-center font-sans">
        <p>No diagnosis data found.</p>
        <button onClick={() => navigate('/')} className="mt-4 text-[#5DCAA5] underline">Return Home</button>
      </div>
    );
  }

  const getSeverityColor = (sev: string) => {
    switch(sev?.toUpperCase()) {
      case 'CRITICAL': return 'text-red-500 bg-red-500/10 border-red-500/20';
      case 'HIGH': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
      case 'MEDIUM': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
      default: return 'text-green-500 bg-green-500/10 border-green-500/20';
    }
  };

  const severityStyles = getSeverityColor(diagnosis.severity);

  return (
    <div className="min-h-screen bg-[#111] text-white font-sans flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/10 bg-[#111]/80 backdrop-blur sticky top-0 z-10 shrink-0">
        <button onClick={() => navigate('/')} className="p-2 hover:bg-white/10 rounded-full transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold text-lg tracking-wide uppercase text-gray-200">Diagnosis Report</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24">
        
        {/* Top Section */}
        <div className="flex gap-4 items-start bg-white/5 p-4 rounded-xl border border-white/10">
          {photo && (
            <div className="w-24 h-24 rounded-lg overflow-hidden border border-white/10 shrink-0 shadow-lg bg-black">
              <img src={photo} alt="Analyzed" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="space-y-1.5 flex-1">
            <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Equipment</p>
            <h2 className="text-lg font-bold leading-tight text-white">{diagnosis.equipmentType}</h2>
            
            <div className="flex flex-wrap gap-2 pt-2">
              <span className={`px-2.5 py-1 rounded border text-xs font-bold flex items-center gap-1 ${severityStyles}`}>
                {diagnosis.severity === 'CRITICAL' ? <AlertTriangle className="w-3 h-3 animate-pulse" /> : null}
                {diagnosis.severity}
              </span>
              <span className="bg-white/10 border border-white/10 px-2.5 py-1 rounded text-xs text-gray-300">
                {Math.round(diagnosis.confidence * 100)}% Match
              </span>
            </div>
          </div>
        </div>

        {/* Issue & Reasoning */}
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-5">
          <h3 className="text-red-400 font-bold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider">
            <AlertTriangle className="w-4 h-4" /> Detected Issue
          </h3>
          <p className="text-gray-200 text-base leading-relaxed font-medium">{diagnosis.issue}</p>
          <div className="mt-4 text-gray-400 text-sm pl-4 border-l-2 border-red-500/20 italic bg-black/20 p-3 rounded-r-lg">
            "{diagnosis.reasoning}"
          </div>
        </div>

        {/* Recommendation */}
        <div className="bg-[#5DCAA5]/5 border border-[#5DCAA5]/20 rounded-xl p-5">
          <h3 className="text-[#5DCAA5] font-bold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider">
            <CheckCircle className="w-4 h-4" /> AI Recommendation
          </h3>
          <div className="flex flex-col gap-2">
            <span className="font-mono bg-[#5DCAA5]/20 text-[#5DCAA5] px-3 py-2 rounded-md font-bold text-center border border-[#5DCAA5]/30">
              {diagnosis.recommendation}
            </span>
            <span className="text-gray-400 text-sm text-center font-medium mt-1">
              Est. Time: <span className="text-white">{diagnosis.estimatedRepairTime}</span>
            </span>
          </div>
        </div>

        {/* Repair Steps */}
        {diagnosis.repairSteps && diagnosis.repairSteps.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h3 className="text-gray-300 font-bold mb-4 text-sm uppercase tracking-wider flex items-center gap-2">
              <Wrench className="w-4 h-4" /> Repair Steps
            </h3>
            <div className="space-y-3">
              {diagnosis.repairSteps.map((step: string, i: number) => (
                <div key={i} className="flex gap-3 text-gray-300 text-sm leading-relaxed bg-black/20 p-3 rounded-lg border border-white/5">
                  <span className="text-[#5DCAA5] font-mono font-bold shrink-0">{i + 1}.</span>
                  <span>{step.replace(/^\d+\.\s*/, '')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Parts Needed */}
        {diagnosis.partsNeeded && diagnosis.partsNeeded.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-8">
            <h3 className="text-gray-300 font-bold mb-4 text-sm uppercase tracking-wider">Parts Needed</h3>
            <div className="space-y-3">
              {diagnosis.partsNeeded.map((part: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg p-3">
                  <div>
                    <div className="text-gray-200 font-medium">{part.name}</div>
                    <div className="text-gray-500 text-xs font-mono mt-1">{part.sku}</div>
                  </div>
                  <div className="text-[#5DCAA5] font-semibold bg-[#5DCAA5]/10 px-2 py-1 rounded">
                    ${part.estimatedCost}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="absolute bottom-0 w-full p-4 border-t border-white/10 bg-[#111]/95 backdrop-blur flex gap-3 z-20">
        <button 
          onClick={() => {
            alert('Self-repair mode activated. Checklist generated.');
            navigate('/');
          }}
          className="flex-1 py-4 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition flex items-center justify-center gap-2"
        >
          <Wrench className="w-5 h-5" /> Try Solo
        </button>
        <button 
          onClick={() => navigate('/live-session')}
          className="flex-1 py-4 bg-[#5DCAA5] hover:bg-[#4eb391] text-black rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-[#5DCAA5]/20"
        >
          <Video className="w-5 h-5" /> Call Expert
        </button>
      </div>
    </div>
  );
}
