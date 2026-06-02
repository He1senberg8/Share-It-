import React, { useEffect, useState, useRef } from 'react';
import { Client } from '@stomp/stompjs';

export default function Signal() {
  const [roomId, setRoomId] = useState('room-123');
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  
  const stompClientRef = useRef(null);

  // Connect to room function, taking an optional custom roomId
  const connectToRoom = (targetRoomId = roomId) => {
    if (stompClientRef.current?.active) return;

    const client = new Client({
      brokerURL: 'ws://localhost:8080/ws-signalling',
      onConnect: () => {
        setIsConnected(true);
        sessionStorage.setItem('activeRoomId', targetRoomId);
        console.log('Connected to Spring Boot STOMP Broker');

        // Subscribe to your specific dynamic room topic
        client.subscribe(`/topic/room/${targetRoomId}`, (message) => {
          const body = JSON.parse(message.body);
          
          if (body.type === 'CHAT') {
            setMessages((prev) => [...prev, `${body.sender}: ${body.payload}`]);
          } else {
            console.log(`Received WebRTC Signal [${body.type}] from ${body.sender}`);
          }
        });
      },
      onDisconnect: () => {
        setIsConnected(false);
        sessionStorage.removeItem('activeRoomId');
        console.log('Disconnected');
      },
      onStompError: (frame) => {
        console.error('STOMP Broker Error: ' + frame.headers['message']);
      }
    });

    client.activate();
    stompClientRef.current = client;
  };

  // Disconnect function
  const disconnectFromRoom = () => {
    if (stompClientRef.current) {
      stompClientRef.current.deactivate();
      stompClientRef.current = null;
      setIsConnected(false);
      sessionStorage.removeItem('activeRoomId');
    }
  };

  // 1. Auto-Reconnect on page reload/refresh if previously connected
  useEffect(() => {
    const savedRoomId = sessionStorage.getItem('activeRoomId');
    if (savedRoomId) {
      setRoomId(savedRoomId);
      connectToRoom(savedRoomId);
    }
  }, []);

  // 2. Warn user before reloading or closing the tab if they are connected
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isConnected) {
        e.preventDefault();
        e.returnValue = 'Are you sure you want to leave? Your connection will be lost.';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isConnected]);

  // 3. Clean up WebSocket connection when component unmounts
  useEffect(() => {
    return () => {
      if (stompClientRef.current) {
        console.log('Cleaning up STOMP client connection on unmount...');
        stompClientRef.current.deactivate();
      }
    };
  }, []);

  const sendChatMessage = () => {
    if (stompClientRef.current && isConnected && inputText.trim()) {
      const msg = {
        type: 'CHAT',
        sender: 'User-' + Math.floor(Math.random() * 1000), // Temp random sender id
        payload: inputText,
        roomId: roomId
      };

      stompClientRef.current.publish({
        destination: `/app/signal/${roomId}`,
        body: JSON.stringify(msg)
      });
      setInputText('');
    }
  };

  return (
    <div 
      className="min-h-screen bg-black flex flex-col justify-center items-center p-4 font-sans text-neutral-200 selection:bg-neutral-850 selection:text-white"
      style={{
        backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
        backgroundSize: '24px 24px'
      }}
    >
      <div className="relative w-full max-w-lg bg-[#0a0a0a] border border-neutral-800 shadow-[0_24px_80px_rgba(0,0,0,0.8),0_0_1px_rgba(255,255,255,0.1)] rounded-xl p-8 overflow-hidden flex flex-col gap-6">
        
        {/* Header */}
        <div className="flex justify-between items-center border-b border-neutral-800/80 pb-5">
          <div className="flex flex-col">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              NexusShare
            </h1>
            <p className="text-xs text-neutral-400 font-mono tracking-widest uppercase mt-1">
              Signalling Panel
            </p>
          </div>

          {/* Status Badge */}
          <div className={`flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-mono font-bold tracking-wider transition-all duration-300 border ${
            isConnected 
              ? 'bg-neutral-900 text-white border-neutral-700' 
              : 'bg-black/40 text-neutral-500 border-neutral-850'
          }`}>
            <span className="relative flex h-2.5 w-2.5">
              {isConnected ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 border border-neutral-600 bg-transparent"></span>
              )}
            </span>
            {isConnected ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>

        {/* Room Connection Bar */}
        <div className="flex flex-col gap-3">
          <label className="text-xs font-bold text-neutral-300 uppercase tracking-widest font-mono">
            Room Configuration
          </label>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-neutral-500 font-mono text-sm pointer-events-none">#</span>
              <input 
                type="text" 
                value={roomId} 
                onChange={(e) => setRoomId(e.target.value)}
                disabled={isConnected}
                className="pl-8 bg-black/60 border border-neutral-800 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 outline-none text-white rounded-lg px-4 py-2.5 w-full transition-all duration-200 disabled:opacity-40 text-sm font-mono tracking-tight"
                placeholder="Room ID"
              />
            </div>
            {isConnected ? (
              <button 
                onClick={disconnectFromRoom} 
                className="bg-transparent hover:bg-neutral-900 border border-neutral-850 hover:border-neutral-500 text-neutral-300 hover:text-white font-mono text-xs font-bold uppercase tracking-wider px-6 py-2.5 rounded-lg transition-all duration-200 cursor-pointer active:scale-[0.97]"
              >
                LEAVE
              </button>
            ) : (
              <button 
                onClick={() => connectToRoom(roomId)} 
                className="bg-white hover:bg-neutral-200 border border-transparent text-black font-mono font-bold text-xs uppercase tracking-wider px-6 py-2.5 rounded-lg transition-all duration-200 cursor-pointer active:scale-[0.97] shadow-sm"
              >
                JOIN
              </button>
            )}
          </div>
        </div>

        {/* Chat / Messages Box */}
        <div className="flex flex-col gap-3">
          <label className="text-xs font-bold text-neutral-300 uppercase tracking-widest font-mono">
            Live Stream
          </label>
          <div className="border border-neutral-800/80 h-72 overflow-y-auto p-5 bg-black/40 rounded-xl space-y-4 scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-neutral-500 gap-3">
                <div className="w-10 h-10 rounded-full border border-neutral-800/60 flex items-center justify-center bg-neutral-950/40">
                  <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-mono text-neutral-400 font-medium">Awaiting stream signals...</p>
                  {!isConnected && (
                    <p className="text-xs text-neutral-600 font-mono mt-1">
                      [ Connect to room to receive logs ]
                    </p>
                  )}
                </div>
              </div>
            ) : (
              messages.map((m, idx) => {
                const colonIndex = m.indexOf(':');
                const sender = colonIndex !== -1 ? m.substring(0, colonIndex) : 'System';
                const text = colonIndex !== -1 ? m.substring(colonIndex + 1).trim() : m;

                return (
                  <div key={idx} className="flex flex-col items-start gap-1">
                    <span className="text-xs font-semibold text-neutral-400 font-mono px-1">
                      {sender}
                    </span>
                    <div className="bg-neutral-900/60 border border-neutral-850 text-neutral-200 px-4 py-2.5 rounded-lg rounded-tl-none text-xs font-mono max-w-[85%] break-all leading-relaxed shadow-sm">
                      {text}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Input Bar */}
        <div className="flex gap-3">
          <input 
            type="text" 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
            disabled={!isConnected}
            className="bg-black border border-neutral-800 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 outline-none text-white rounded-lg px-4 py-3 flex-1 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed text-sm placeholder-neutral-600 font-sans"
            placeholder={isConnected ? "Send message..." : "Join a room to stream messages"}
          />
          <button 
            onClick={sendChatMessage} 
            disabled={!isConnected || !inputText.trim()}
            className="bg-white hover:bg-neutral-200 disabled:bg-neutral-950 disabled:border-neutral-900 disabled:text-neutral-800 border border-transparent text-black font-semibold rounded-lg px-5 py-3 transition-all duration-200 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed active:scale-[0.97] shadow-md"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}