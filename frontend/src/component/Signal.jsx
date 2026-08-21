import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import useWebRTC from '../hooks/useWebRTC';
import FileProcessor from './FileProcessor';

export default function Signal() {
  const [roomId, setRoomId] = useState('room-default');
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [signalLogs, setSignalLogs] = useState([]);

  const stompClientRef = useRef(null);

  // Keep roomId, isConnected, and stompClientRef in refs to prevent stale closures
  const roomIdRef = useRef(roomId);
  const isConnectedRef = useRef(isConnected);

  useEffect(() => {
    roomIdRef.current = roomId;
    isConnectedRef.current = isConnected;
  }, [roomId, isConnected]);

  const addSignalLog = useCallback((logText) => {
    const timestamp = new Date().toLocaleTimeString();
    setSignalLogs((prev) => [`[${timestamp}] ${logText}`, ...prev.slice(0, 19)]);
  }, []);

  // Global Error Interceptors to display exceptions in the Broker Log on-screen
  useEffect(() => {
    const originalConsoleError = console.error;
    const originalConsoleLog = console.log;

    const handleGlobalError = (event) => {
      addSignalLog(`EXCEPTION: ${event.message || event}`);
    };

    const handleRejection = (event) => {
      addSignalLog(`PROMISE REJECTION: ${event.reason?.message || event.reason}`);
    };

    console.error = (...args) => {
      originalConsoleError.apply(console, args);
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      addSignalLog(`CONSOLE ERROR: ${msg}`);
    };

    console.log = (...args) => {
      originalConsoleLog.apply(console, args);
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      addSignalLog(`CONSOLE LOG: ${msg}`);
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      console.error = originalConsoleError;
      console.log = originalConsoleLog;
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [addSignalLog]);

  // Signalling callback to bridge WebRTC signals to Spring Boot STOMP broker
  const sendSignal = useCallback((signalObj) => {
    if (stompClientRef.current?.active && isConnectedRef.current) {
      const messagePayload = {
        type: signalObj.type,
        sender: signalObj.sender,
        payload: signalObj.payload,
        roomId: roomIdRef.current
      };
      
      stompClientRef.current.publish({
        destination: `/app/signal/${roomIdRef.current}`,
        body: JSON.stringify(messagePayload)
      });
      
      addSignalLog(`OUTBOUND: sent WebRTC [${signalObj.type}]`);
    } else {
      addSignalLog(`WARNING: Cannot send [${signalObj.type}], WebSocket inactive or disconnected.`);
    }
  }, [addSignalLog]);

  // Instantiate our WebRTC custom hook
  const {
    clientUuid,
    initiateCall,
    processIncomingSignal,
    sendDirectMessage,
    sendFileMetadata,
    waitForReceiverReady,
    sendFileChunk,
    completeSendingFile,
    registerFileReceivingCallbacks,
    acceptIncomingFile,
    declineIncomingFile,
    cancelFileTransfer,
    receivedMessages: webrtcMessages,
    connectionState,
    transferProgress,
    transferSpeed,
    transferState,
    transferFileName,
    transferFileSize,
    transferFileMimeType
  } = useWebRTC(sendSignal);

  // Store processIncomingSignal in a ref to prevent subscription closures
  const processIncomingSignalRef = useRef(processIncomingSignal);
  useEffect(() => {
    processIncomingSignalRef.current = processIncomingSignal;
  }, [processIncomingSignal]);

  // Connect to room function, taking an optional custom roomId
  const connectToRoom = (targetRoomId = roomId) => {
    if (stompClientRef.current?.active) return;

    console.log(`Connecting to room: ${targetRoomId}`);
    const isSecure = window.location.protocol === 'https:';
    const wsProtocol = isSecure ? 'wss:' : 'ws:';
    const defaultBrokerURL = `${wsProtocol}//${window.location.hostname}:8080/ws-signalling`;
    const targetBrokerURL = import.meta.env.VITE_BROKER_URL || defaultBrokerURL;

    const client = new Client({
      brokerURL: targetBrokerURL,
      onConnect: () => {
        setIsConnected(true);
        sessionStorage.setItem('activeRoomId', targetRoomId);
        addSignalLog(`WebSocket Connected. Listening on room #${targetRoomId}`);

        // Subscribe to dynamic room topic
        client.subscribe(`/topic/room/${targetRoomId}`, (message) => {
          const body = JSON.parse(message.body);

          // Ignore self-published signals
          if (body.sender === clientUuid) return;

          if (body.type === 'CHAT') {
            setMessages((prev) => [...prev, `${body.sender}: ${body.payload}`]);
          } else {
            addSignalLog(`INBOUND: received WebRTC [${body.type}] from ${body.sender.substring(0, 8)}`);
            processIncomingSignalRef.current(body);
          }
        });
      },
      onDisconnect: () => {
        setIsConnected(false);
        sessionStorage.removeItem('activeRoomId');
        addSignalLog('WebSocket Disconnected');
      },
      onStompError: (frame) => {
        console.error('STOMP Broker Error: ' + frame.headers['message']);
        addSignalLog(`Error: ${frame.headers['message']}`);
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
        stompClientRef.current.deactivate();
      }
    };
  }, []);

  const sendChatMessage = () => {
    if (stompClientRef.current && isConnected && inputText.trim()) {
      const msg = {
        type: 'CHAT',
        sender: clientUuid.substring(0, 8),
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
      className="min-h-screen bg-slate-950 text-slate-200 font-mono text-sm selection:bg-slate-800 selection:text-white p-6 md:p-12 flex flex-col items-center justify-start gap-8"
      style={{
        backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px)',
        backgroundSize: '24px 24px'
      }}
    >
      {/* Dashboard Card */}
      <div className="w-full max-w-6xl bg-slate-900 border border-slate-800/80 shadow-[0_24px_80px_rgba(0,0,0,0.6)] rounded-xl p-6 md:p-8 flex flex-col gap-8">
        
        {/* Header Block */}
        <div className="flex justify-between items-center border-b border-slate-800/60 pb-5">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2 font-mono">
              SHARE_IT <span className="text-[10px] bg-slate-950 text-slate-400 border border-slate-850 px-2 py-0.5 rounded font-mono font-normal">v2.0.0</span>
            </h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">
              Direct Peer-to-Peer file sharing terminal
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* STOMP status */}
            <span className="text-[10px] text-slate-500">SIGNAL:</span>
            <div className={`px-3 py-1 rounded-md border text-[10px] font-bold tracking-wider ${
              isConnected 
                ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/50' 
                : 'bg-slate-950 text-slate-600 border-slate-850'
            }`}>
              {isConnected ? 'ONLINE' : 'OFFLINE'}
            </div>
          </div>
        </div>

        {/* Console layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Connection Setup & Controls */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Local Device ID
              </label>
              <div className="bg-slate-950 border border-slate-850 rounded-lg p-3 text-xs text-slate-300 select-all truncate">
                {clientUuid}
              </div>
            </div>

            {/* Room Connection Card */}
            <div className="flex flex-col gap-3">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Room Configuration
              </label>
              <div className="flex flex-col gap-2">
                <input 
                  type="text" 
                  value={roomId} 
                  onChange={(e) => setRoomId(e.target.value)}
                  disabled={isConnected}
                  className="bg-slate-950 border border-slate-850 focus:border-slate-700 outline-none text-white rounded-lg px-3 py-2.5 text-xs font-mono disabled:opacity-40"
                  placeholder="Enter Room Code"
                />
                {isConnected ? (
                  <button 
                    onClick={disconnectFromRoom} 
                    className="w-full bg-transparent hover:bg-slate-950 border border-slate-850 hover:border-slate-750 text-slate-400 hover:text-white text-xs font-bold uppercase tracking-wider py-2.5 rounded-lg transition-all duration-200 cursor-pointer"
                  >
                    LEAVE SIGNAL GATE
                  </button>
                ) : (
                  <button 
                    onClick={() => connectToRoom(roomId)} 
                    className="w-full bg-white hover:bg-slate-200 border border-transparent text-slate-950 text-xs font-bold uppercase tracking-wider py-2.5 rounded-lg transition-all duration-200 cursor-pointer shadow-md"
                  >
                    ESTABLISH GATEWAY
                  </button>
                )}
              </div>
            </div>

            {/* WebRTC Direct Connection Controller */}
            <div className="flex flex-col gap-3 border-t border-slate-800/60 pt-5">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                P2P Link Status
              </label>
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center bg-slate-950 border border-slate-850 rounded-lg p-3">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">CONNECTION:</span>
                  <span className={`text-[10px] font-bold tracking-wider ${
                    connectionState === 'connected' 
                      ? 'text-emerald-400' 
                      : connectionState === 'connecting'
                      ? 'text-amber-500'
                      : 'text-slate-500'
                  }`}>
                    {connectionState.toUpperCase()}
                  </span>
                </div>
                <button
                  onClick={initiateCall}
                  disabled={!isConnected || connectionState === 'connected' || connectionState === 'connecting'}
                  className="w-full bg-slate-950 hover:bg-slate-850 border border-slate-850 text-white text-xs font-bold uppercase tracking-wider py-2.5 rounded-lg transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  INITIATE P2P LINK
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: File Transfer Operations */}
          <div className="lg:col-span-8 flex flex-col gap-6 bg-slate-950/40 border border-slate-800/50 p-6 rounded-xl">
            <FileProcessor
              sendFileMetadata={sendFileMetadata}
              waitForReceiverReady={waitForReceiverReady}
              sendFileChunk={sendFileChunk}
              completeSendingFile={completeSendingFile}
              registerFileReceivingCallbacks={registerFileReceivingCallbacks}
              acceptIncomingFile={acceptIncomingFile}
              declineIncomingFile={declineIncomingFile}
              cancelFileTransfer={cancelFileTransfer}
              transferProgress={transferProgress}
              transferSpeed={transferSpeed}
              transferState={transferState}
              transferFileName={transferFileName}
              transferFileSize={transferFileSize}
              transferFileMimeType={transferFileMimeType}
              connectionState={connectionState}
            />
          </div>
        </div>

        {/* Bottom Console: Logs & Room Chat */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 border-t border-slate-800/60 pt-6">
          
          {/* Signalling Log Console */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Signalling Broker Logs
            </label>
            <div className="bg-slate-950 border border-slate-850 rounded-lg h-44 overflow-y-auto p-4 flex flex-col-reverse gap-1.5 text-[10px] font-mono text-slate-500 scrollbar-thin scrollbar-thumb-slate-850 scrollbar-track-transparent">
              {signalLogs.length === 0 ? (
                <div className="text-slate-700 italic">No broker logs compiled.</div>
              ) : (
                signalLogs.map((log, index) => (
                  <div key={index} className="truncate select-none whitespace-pre-wrap">{log}</div>
                ))
              )}
            </div>
          </div>

          {/* Room Signaling Chat */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Broadband Room Feed
            </label>
            <div className="flex flex-col border border-slate-850 rounded-lg overflow-hidden">
              <div className="bg-slate-950 h-28 overflow-y-auto p-3 space-y-2 scrollbar-thin scrollbar-thumb-slate-850 scrollbar-track-transparent">
                {messages.length === 0 ? (
                  <div className="text-[10px] text-slate-700 italic">No messages broadcast.</div>
                ) : (
                  messages.map((m, idx) => {
                    const colonIndex = m.indexOf(':');
                    const sender = colonIndex !== -1 ? m.substring(0, colonIndex) : 'System';
                    const text = colonIndex !== -1 ? m.substring(colonIndex + 1).trim() : m;
                    return (
                      <div key={idx} className="text-[10px] font-mono">
                        <span className="text-slate-400 font-bold">{sender}:</span>{' '}
                        <span className="text-slate-300">{text}</span>
                      </div>
                    );
                  })
                )}
              </div>
              
              {/* Message inputs */}
              <div className="flex border-t border-slate-850 bg-slate-900 p-1.5 gap-2">
                <input 
                  type="text" 
                  value={inputText} 
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                  disabled={!isConnected}
                  className="bg-slate-950 border border-slate-850 focus:border-slate-700 outline-none text-white rounded px-2.5 py-1.5 flex-1 text-xs placeholder-slate-700 font-mono disabled:opacity-40"
                  placeholder="Broadcast message..."
                />
                <button 
                  onClick={sendChatMessage} 
                  disabled={!isConnected || !inputText.trim()}
                  className="bg-slate-950 hover:bg-slate-800 disabled:bg-slate-950 disabled:text-slate-700 border border-slate-850 disabled:border-slate-900 text-white rounded text-[10px] uppercase font-bold px-3 py-1 cursor-pointer disabled:cursor-not-allowed"
                >
                  SEND
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}