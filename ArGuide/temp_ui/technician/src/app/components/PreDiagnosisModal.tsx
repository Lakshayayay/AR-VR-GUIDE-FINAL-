import React, { useState, useRef } from 'react';
import { Camera, Upload, X, Loader2, Bot, AlertTriangle, CheckCircle, Info } from 'lucide-react';

interface PreDiagnosisModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
}

export default function PreDiagnosisModal({ isOpen, onClose, videoRef }: PreDiagnosisModalProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const analyzeImage = async (base64Image: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setImagePreview(base64Image);

    try {
      const response = await fetch(`http://${window.location.hostname}:3001/api/pre-diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: base64Image,
          equipmentType: 'general'
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setResult(data.diagnosis);
      } else {
        setError(data.error || 'Diagnosis failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect to AI service');
    } finally {
      setLoading(false);
    }
  };

  const handleCapture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    analyzeImage(dataUrl);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        analyzeImage(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const getSeverityColor = (sev: string) => {
    switch(sev?.toUpperCase()) {
      case 'CRITICAL': return 'text-red-500';
      case 'HIGH': return 'text-orange-500';
      case 'MEDIUM': return 'text-yellow-500';
      default: return 'text-green-500';
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#111] border border-gray-800 rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-2 text-white">
            <Bot className="w-5 h-5 text-[#5DCAA5]" />
            <h2 className="font-semibold">AI Pre-Session Diagnosis</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1">
          {!loading && !result && !error && (
            <div className="flex flex-col gap-4 py-8">
              <p className="text-gray-400 text-sm text-center mb-4">
                Take a photo of the equipment or upload an image to receive an AI diagnosis before starting the live session.
              </p>
              <div className="flex gap-4 justify-center">
                <button 
                  onClick={handleCapture}
                  className="flex flex-col items-center gap-2 p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-white flex-1"
                >
                  <Camera className="w-8 h-8 text-[#5DCAA5]" />
                  <span className="text-sm">Capture Live View</span>
                </button>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-white flex-1"
                >
                  <Upload className="w-8 h-8 text-[#5DCAA5]" />
                  <span className="text-sm">Upload Image</span>
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
              </div>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-10 h-10 text-[#5DCAA5] animate-spin" />
              <p className="text-white text-sm animate-pulse">Analyzing equipment and generating diagnosis...</p>
              {imagePreview && (
                <div className="mt-4 w-48 h-32 rounded border border-gray-700 overflow-hidden opacity-50">
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <AlertTriangle className="w-12 h-12 text-red-500" />
              <div className="text-red-400 text-sm bg-red-500/10 p-3 rounded border border-red-500/20">
                {error}
              </div>
              <button 
                onClick={() => { setError(null); setImagePreview(null); }}
                className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded text-sm transition"
              >
                Try Again
              </button>
            </div>
          )}

          {result && !loading && (
            <div className="flex flex-col gap-4 text-white text-sm">
              <div className="flex gap-4 items-start">
                {imagePreview && (
                  <div className="w-24 h-24 rounded border border-gray-700 overflow-hidden shrink-0">
                    <img src={imagePreview} alt="Analyzed" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1 space-y-1">
                  <div className="text-gray-400 text-xs uppercase tracking-wider">Equipment</div>
                  <div className="font-semibold text-lg">{result.equipmentType}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-gray-400 text-xs">Severity:</span>
                    <span className={`font-bold ${getSeverityColor(result.severity)}`}>{result.severity}</span>
                  </div>
                </div>
              </div>

              <div className="bg-red-500/10 border border-red-500/20 rounded p-3 mt-2">
                <div className="text-red-400 font-semibold mb-1 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Issue Detected
                </div>
                <p className="text-gray-300">{result.issue}</p>
                <p className="text-gray-400 mt-2 text-xs italic">{result.reasoning}</p>
              </div>

              <div className="bg-[#5DCAA5]/10 border border-[#5DCAA5]/20 rounded p-3">
                <div className="text-[#5DCAA5] font-semibold mb-1 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" /> Recommendation
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-mono text-xs bg-[#5DCAA5]/20 px-2 py-1 rounded text-[#5DCAA5]">
                    {result.recommendation}
                  </span>
                  <span className="text-gray-400 text-xs">Est. Time: {result.estimatedRepairTime}</span>
                </div>
              </div>

              {result.repairSteps && result.repairSteps.length > 0 && (
                <div className="mt-2">
                  <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Repair Steps</div>
                  <div className="space-y-1 bg-white/5 rounded p-3 border border-white/10">
                    {result.repairSteps.map((step: string, i: number) => (
                      <div key={i} className="text-gray-300 text-sm">{step}</div>
                    ))}
                  </div>
                </div>
              )}

              {result.partsNeeded && result.partsNeeded.length > 0 && (
                <div className="mt-2 mb-4">
                  <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Parts Needed</div>
                  <div className="space-y-2">
                    {result.partsNeeded.map((part: any, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-white/5 rounded p-2 border border-white/10">
                        <div>
                          <div className="text-gray-200">{part.name}</div>
                          <div className="text-gray-500 text-xs font-mono">{part.sku}</div>
                        </div>
                        <div className="text-[#5DCAA5]">${part.estimatedCost}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Footer */}
        {result && !loading && (
          <div className="p-4 border-t border-gray-800 flex gap-3">
            <button 
              onClick={() => { setResult(null); setImagePreview(null); }}
              className="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white rounded transition text-sm font-medium"
            >
              Start Over
            </button>
            <button 
              onClick={onClose}
              className="flex-1 py-2 bg-[#5DCAA5] hover:bg-[#4eb391] text-black rounded transition text-sm font-semibold"
            >
              {result.recommendation === 'CALL_EXPERT' ? 'Call Expert Now' : 'Continue to Live Session'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
