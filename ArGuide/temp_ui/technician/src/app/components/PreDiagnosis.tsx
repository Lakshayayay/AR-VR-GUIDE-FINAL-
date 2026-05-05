import React, { useState, useRef, useEffect } from 'react';
import { Camera, RefreshCw, Upload, ArrowLeft, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function PreDiagnosis() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const initCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error('Camera access denied:', err);
      setError('Camera access required to take photos. Please use upload instead.');
    }
  };

  const handleCapture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      setPhoto(canvas.toDataURL('image/jpeg', 0.8));
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setPhoto(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!photo) return;
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`http://${window.location.hostname}:3001/api/pre-diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: photo })
      });
      
      const result = await response.json();
      
      if (result.success) {
        navigate('/diagnosis-result', { state: { diagnosis: result.diagnosis, photo } });
      } else {
        setError(result.error || 'Diagnosis failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect to AI service');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full h-screen bg-[#111] overflow-hidden flex flex-col font-sans">
      <div className="absolute top-4 left-4 z-30">
        <button onClick={() => navigate('/')} className="bg-black/50 backdrop-blur text-white p-2 rounded-full hover:bg-black/70 transition">
          <ArrowLeft className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center bg-black">
        {!photo ? (
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover z-0" />
        ) : (
          <img src={photo} alt="Captured" className="absolute inset-0 w-full h-full object-contain z-0" />
        )}

        {loading && (
          <div className="absolute inset-0 z-40 bg-black/80 flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 text-[#5DCAA5] animate-spin mb-4" />
            <p className="text-white animate-pulse text-lg">AI analyzing equipment...</p>
          </div>
        )}
      </div>

      <div className="bg-[#111] p-6 pb-10 z-20 shadow-2xl border-t border-white/10 shrink-0">
        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm text-center">
            {error}
          </div>
        )}

        {!photo ? (
          <div className="flex items-center justify-center gap-6">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition"
            >
              <Upload className="w-6 h-6" />
            </button>
            <input type="file" ref={fileInputRef} onChange={handleUpload} accept="image/*" className="hidden" />
            
            <button 
              onClick={handleCapture}
              className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg border-4 border-gray-300 active:scale-95 transition-transform"
            >
              <Camera className="w-8 h-8 text-black" />
            </button>
            
            <div className="w-14 h-14" /> {/* Spacer for balance */}
          </div>
        ) : (
          <div className="flex gap-4">
            <button 
              onClick={() => setPhoto(null)}
              className="flex-1 py-4 bg-white/10 hover:bg-white/20 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition"
            >
              <RefreshCw className="w-5 h-5" /> Retake
            </button>
            <button 
              onClick={handleAnalyze}
              disabled={loading}
              className="flex-1 py-4 bg-[#5DCAA5] hover:bg-[#4eb391] text-black font-semibold rounded-xl flex items-center justify-center gap-2 transition"
            >
              Analyze Photo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
