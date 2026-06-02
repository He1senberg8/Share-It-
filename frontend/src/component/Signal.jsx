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
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 font-sans text-slate-100 selection:bg-indigo-500/30">
      
      {/* Decorative Glow Backdrops */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 shadow-2xl rounded-2xl p-6 overflow-hidden flex flex-col gap-5">
        
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-800/60 pb-4">
          <div className="flex flex-col">
            <h1 className="text-xl font-bold bg-linear-to-r from-violet-400 via-indigo-300 to-cyan-400 bg-clip-text text-transparent tracking-wide">
              NexusShare
            </h1>
            <p className="text-xs text-slate-400">Workspace Signalling Panel</p>
          </div>

          {/* Status Badge */}
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold transition-all duration-300 border ${
            isConnected 
              ? 'bg-emerald-950/30 text-emerald-400 border-emerald-800/50' 
              : 'bg-slate-850 text-slate-400 border-slate-800'
          }`}>
            <span className="relative flex h-2 w-2">
              {isConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${
                isConnected ? 'bg-emerald-500' : 'bg-slate-500'
              }`}></span>
            </span>
            {isConnected ? 'Active' : 'Offline'}
          </div>
        </div>

        {/* Room Connection Bar */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Room Configuration</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 pointer-events-none">#</span>
              <input 
                type="text" 
                value={roomId} 
                onChange={(e) => setRoomId(e.target.value)}
                disabled={isConnected}
                className="pl-7 bg-slate-950/60 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-slate-100 rounded-xl px-3 py-2 w-full transition-all duration-200 disabled:opacity-50 text-sm font-medium"
                placeholder="Room ID"
              />
            </div>
            {isConnected ? (
              <button 
                onClick={disconnectFromRoom} 
                className="bg-slate-850 hover:bg-red-950/40 hover:text-red-400 hover:border-red-900/50 border border-slate-850 text-slate-300 font-medium px-5 py-2 rounded-xl active:scale-98 transition-all duration-200 text-sm cursor-pointer"
              >
                Leave
              </button>
            ) : (
              <button 
                onClick={() => connectToRoom(roomId)} 
                className="bg-linear-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium px-5 py-2 rounded-xl shadow-lg shadow-indigo-500/20 active:scale-98 transition-all duration-200 text-sm cursor-pointer"
              >
                Join
              </button>
            )}
          </div>
        </div>

        {/* Chat / Messages Box */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Live Stream</label>
          <div className="border border-slate-800/80 h-60 overflow-y-auto p-4 bg-slate-950/40 rounded-xl space-y-3.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                <svg className="w-8 h-8 opacity-40 animate-pulse text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-xs font-medium tracking-wide">No messages or signalling events yet.</p>
                {!isConnected && <p className="text-[10px] text-slate-600">Join a room to start streaming</p>}
              </div>
            ) : (
              messages.map((m, idx) => {
                const colonIndex = m.indexOf(':');
                const sender = colonIndex !== -1 ? m.substring(0, colonIndex) : 'System';
                const text = colonIndex !== -1 ? m.substring(colonIndex + 1).trim() : m;

                return (
                  <div key={idx} className="flex flex-col items-start gap-1">
                    <span className="text-[10px] text-slate-400 font-semibold font-mono px-1">
                      {sender}
                    </span>
                    <div className="bg-slate-800/80 border border-slate-700/50 text-slate-200 px-3.5 py-2 rounded-2xl rounded-tl-none text-sm max-w-[85%] wrap-break-word leading-relaxed shadow-sm">
                      {text}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Input Bar */}
        <div className="flex gap-2">
          <input 
            type="text" 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
            disabled={!isConnected}
            className="bg-slate-950/60 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-slate-100 rounded-xl px-4 py-2.5 flex-1 transition-all duration-200 disabled:opacity-40 text-sm"
            placeholder={isConnected ? "Type message..." : "Join a room to type"}
          />
          <button 
            onClick={sendChatMessage} 
            disabled={!isConnected || !inputText.trim()}
            className="bg-indigo-650 hover:bg-indigo-600 disabled:bg-slate-850 disabled:text-slate-500 disabled:opacity-50 text-white font-semibold rounded-xl px-5 py-2.5 transition-all duration-200 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}