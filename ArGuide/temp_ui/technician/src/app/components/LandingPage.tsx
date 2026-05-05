import { Bot, UserCircle, Phone, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3000`;

export default function LandingPage() {
  const navigate = useNavigate();
  const [isCalling, setIsCalling] = useState(false);
  const [sessionId] = useState(`SES-${new Date().getTime().toString().slice(-6)}`);
  const socketRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const handleCallExpert = () => {
    setIsCalling(true);
    socketRef.current = io(SERVER_URL);
    
    socketRef.current.on('connect', () => {
      console.log('Connected to server, sending call...');
      socketRef.current.emit('incoming-call', {
        sessionId,
        callerName: 'Technician',
        location: 'Field'
      });
    });

    socketRef.current.on('connect_error', (err: any) => {
      console.error('Technician socket connection error:', err);
    });

    socketRef.current.on('call-accepted', (data: any) => {
      socketRef.current.disconnect();
      navigate('/live-session', { state: { sessionId } });
    });

    socketRef.current.on('call-rejected', () => {
      setIsCalling(false);
      socketRef.current.disconnect();
      alert('Expert declined the call.');
    });
  };

  const cancelCall = () => {
    setIsCalling(false);
    if (socketRef.current) socketRef.current.disconnect();
  };

  if (isCalling) {
    return (
      <div className="min-h-screen bg-[#111] flex flex-col items-center justify-center p-6 text-white font-sans relative overflow-hidden">
        {/* Pulsing background effect */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
           <div className="w-64 h-64 bg-blue-500/20 rounded-full animate-ping opacity-70"></div>
           <div className="absolute w-96 h-96 bg-blue-500/10 rounded-full animate-pulse opacity-50 delay-150"></div>
        </div>

        <div className="z-10 flex flex-col items-center text-center">
          <div className="w-24 h-24 bg-blue-500/20 rounded-full flex items-center justify-center mb-8 border border-blue-500/30">
            <Phone className="w-10 h-10 text-blue-400 animate-pulse" />
          </div>
          <h2 className="text-3xl font-bold mb-2 tracking-wide">Calling Expert...</h2>
          <p className="text-gray-400 mb-12">Waiting for an expert to accept</p>

          <button 
            onClick={cancelCall}
            className="bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 text-red-400 rounded-full p-4 transition-all hover:scale-105 active:scale-95"
          >
            <X className="w-8 h-8" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111] flex flex-col items-center justify-center p-6 text-white font-sans">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-2">ArGuide Technician</h1>
          <p className="text-gray-400">Select an option to begin your session</p>
          <div className="mt-4 bg-white/5 border border-white/10 rounded-full py-1.5 px-4 inline-flex font-mono text-xs text-[#5DCAA5]">
            SESSION ID: {sessionId}
          </div>
        </div>

        <div className="space-y-4">
          {/* Card 1 */}
          <button 
            onClick={() => navigate('/pre-diagnosis')}
            className="w-full text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#5DCAA5]/50 transition-all rounded-xl p-6 flex items-start gap-4 group"
          >
            <div className="bg-[#5DCAA5]/20 p-3 rounded-lg group-hover:scale-110 transition-transform">
              <Bot className="w-8 h-8 text-[#5DCAA5]" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-1">AI Pre-Diagnosis</h2>
              <p className="text-gray-400 text-sm">Take a photo for instant equipment diagnosis and repair steps.</p>
            </div>
          </button>

          {/* Card 2 */}
          <button 
            onClick={handleCallExpert}
            className="w-full text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 transition-all rounded-xl p-6 flex items-start gap-4 group"
          >
            <div className="bg-blue-500/20 p-3 rounded-lg group-hover:scale-110 transition-transform">
              <UserCircle className="w-8 h-8 text-blue-500" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-1">Call Expert</h2>
              <p className="text-gray-400 text-sm">Start a live video session with remote expert assistance.</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
