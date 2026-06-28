import React, { useRef, useState, useCallback, useEffect } from 'react';

const getIceServers = () => {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];

  // Safely check for Vite environment variables for TURN server config
  const turnUrl = import.meta.env?.VITE_TURN_URL;
  const turnUsername = import.meta.env?.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env?.VITE_TURN_PASSWORD;

  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential
    });
    console.log('TURN Server Configured successfully.');
  }

  return servers;
};

const WEBRTC_CONFIG = {
  iceServers: getIceServers()
};

const useWebRTC = (sendSignal) => {
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const clientUuid = useRef('peer-' + Math.random().toString(36).substring(2, 11));

  // Store sendSignal in a ref to prevent stale closures in event listeners
  const sendSignalRef = useRef(sendSignal);
  useEffect(() => {
    sendSignalRef.current = sendSignal;
  }, [sendSignal]);

  // Connection & Chat States
  const [connectionState, setConnectionState] = useState('disconnected');
  const [receivedMessages, setReceivedMessages] = useState([]);

  // File Transfer States
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState('0 KB/s');
  const [transferState, setTransferState] = useState('idle'); // 'idle' | 'sending' | 'receiving' | 'awaiting_acceptance' | 'completed' | 'error'
  const [transferFileName, setTransferFileName] = useState('');
  const [transferFileSize, setTransferFileSize] = useState(0);
  const [transferFileMimeType, setTransferFileMimeType] = useState('');

  // Keep references to state values for callback scopes
  const transferFileNameRef = useRef('');
  const transferFileSizeRef = useRef(0);
  const transferFileMimeTypeRef = useRef('');

  useEffect(() => {
    transferFileNameRef.current = transferFileName;
  }, [transferFileName]);

  useEffect(() => {
    transferFileSizeRef.current = transferFileSize;
  }, [transferFileSize]);

  useEffect(() => {
    transferFileMimeTypeRef.current = transferFileMimeType;
  }, [transferFileMimeType]);

  // Callbacks for file receiving (to be set by the component utilizing the hook)
  const fileStartCallback = useRef(null);
  const fileChunkCallback = useRef(null);
  const fileEndCallback = useRef(null);
  const fileCancelCallback = useRef(null);

  // Handshake helper: wait for receiver to be ready
  const resolveFileReadyRef = useRef(null);
  const fileReadyPromiseRef = useRef(null);

  // Speed Tracking Refs
  const bytesAccumulated = useRef(0);
  const speedIntervalId = useRef(null);
  const lastTime = useRef(0);

  const startSpeedTracker = useCallback(() => {
    if (speedIntervalId.current) clearInterval(speedIntervalId.current);
    lastTime.current = performance.now();
    bytesAccumulated.current = 0;

    speedIntervalId.current = setInterval(() => {
      const now = performance.now();
      const elapsedSec = (now - lastTime.current) / 1000;
      if (elapsedSec <= 0) return;

      const speedBytesPerSec = bytesAccumulated.current / elapsedSec;
      
      // Format speed
      if (speedBytesPerSec > 1024 * 1024) {
        setTransferSpeed((speedBytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s');
      } else {
        setTransferSpeed((speedBytesPerSec / 1024).toFixed(1) + ' KB/s');
      }

      // Reset window
      bytesAccumulated.current = 0;
      lastTime.current = now;
    }, 1000);
  }, []);

  const stopSpeedTracker = useCallback(() => {
    if (speedIntervalId.current) {
      clearInterval(speedIntervalId.current);
      speedIntervalId.current = null;
    }
    setTransferSpeed('0 KB/s');
  }, []);

  const setupDataChannelEvents = useCallback((channel) => {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 65536; // 64 KB

    channel.onopen = () => {
      console.log('Direct P2P channel opened');
      setConnectionState('connected');
    };

    channel.onclose = () => {
      console.log('Direct P2P channel closed');
      setConnectionState('disconnected');
      stopSpeedTracker();
    };

    let totalExpectedBytes = 0;
    let totalReceivedBytes = 0;

    channel.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        // Handle control messages or chat
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'CHAT') {
            setReceivedMessages((prev) => [...prev, `${message.sender}: ${message.payload}`]);
          } else if (message.type === 'FILE_START') {
            console.log('File Transfer Initiated by Peer:', message.name, 'MIME:', message.mimeType);
            setTransferFileName(message.name);
            setTransferFileSize(message.size);
            setTransferFileMimeType(message.mimeType || '');
            
            // Set state to await acceptance (wait for user click gesture before showing prompt)
            setTransferState('awaiting_acceptance');
            setTransferProgress(0);
            totalExpectedBytes = message.size;
            totalReceivedBytes = 0;

          } else if (message.type === 'FILE_READY') {
            console.log('Receiver is ready. Resolving lock...');
            if (resolveFileReadyRef.current) {
              resolveFileReadyRef.current();
            }
          } else if (message.type === 'FILE_CANCEL') {
            console.log('File transfer cancelled by sender.');
            setTransferState('idle');
            stopSpeedTracker();
            setTransferProgress(0);

            if (fileCancelCallback.current) {
              await fileCancelCallback.current();
            }
          } else if (message.type === 'FILE_END') {
            setTransferProgress(100);
            setTransferState('completed');
            stopSpeedTracker();

            if (fileEndCallback.current) {
              await fileEndCallback.current();
            }
          }
        } catch (err) {
          console.error('Failed to parse text message over WebRTC channel:', err);
        }
      } else {
        // Handle binary chunk (ArrayBuffer)
        const chunk = event.data;
        totalReceivedBytes += chunk.byteLength;
        bytesAccumulated.current += chunk.byteLength;

        if (totalExpectedBytes > 0) {
          const progress = Math.min(99.9, (totalReceivedBytes / totalExpectedBytes) * 100);
          setTransferProgress(progress);
        }

        if (fileChunkCallback.current) {
          await fileChunkCallback.current(chunk);
        }
      }
    };
  }, [startSpeedTracker, stopSpeedTracker]);

  const acceptIncomingFile = useCallback(async () => {
    try {
      console.log('Accepting incoming file:', transferFileNameRef.current);
      setTransferState('receiving');
      startSpeedTracker();

      if (fileStartCallback.current) {
        await fileStartCallback.current({ 
          name: transferFileNameRef.current, 
          size: transferFileSizeRef.current,
          mimeType: transferFileMimeTypeRef.current
        });
      }

      if (dataChannel.current && dataChannel.current.readyState === 'open') {
        console.log('Storage initialized. Sending FILE_READY to sender...');
        dataChannel.current.send(JSON.stringify({ type: 'FILE_READY' }));
      }
    } catch (err) {
      console.error('Failed to initialize transfer acceptance:', err);
      setTransferState('idle');
      stopSpeedTracker();
    }
  }, [startSpeedTracker, stopSpeedTracker]);

  const declineIncomingFile = useCallback(() => {
    setTransferState('idle');
    setTransferProgress(0);
    setTransferFileName('');
    setTransferFileSize(0);
    setTransferFileMimeType('');
  }, []);

  const cancelFileTransfer = useCallback(async () => {
    console.log('Cancelling file transfer...');
    setTransferState('idle');
    stopSpeedTracker();
    setTransferProgress(0);

    if (dataChannel.current && dataChannel.current.readyState === 'open') {
      dataChannel.current.send(JSON.stringify({ type: 'FILE_CANCEL' }));
    }

    if (fileCancelCallback.current) {
      await fileCancelCallback.current();
    }
  }, [stopSpeedTracker]);

  const initializePeer = useCallback(() => {
    if (peerConnection.current) return peerConnection.current;

    console.log('Initializing RTCPeerConnection...');
    const pc = new RTCPeerConnection(WEBRTC_CONFIG);
    peerConnection.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignalRef.current({
          type: 'ICE_CANDIDATE',
          sender: clientUuid.current,
          payload: JSON.stringify(event.candidate)
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE Connection State Change:', pc.iceConnectionState);
      setConnectionState(pc.iceConnectionState);
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        stopSpeedTracker();
      }
    };

    pc.ondatachannel = (event) => {
      console.log('Data channel received from remote peer');
      const channel = event.channel;
      setupDataChannelEvents(channel);
      dataChannel.current = channel;
    };

    return pc;
  }, [setupDataChannelEvents, stopSpeedTracker]);

  const initiateCall = useCallback(async () => {
    try {
      console.log('Initiating direct call...');
      const pc = initializePeer();

      const channel = pc.createDataChannel('file-share-channel');
      setupDataChannelEvents(channel);
      dataChannel.current = channel;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      console.log('Local description (Offer) set. Sending via signalling...');
      sendSignalRef.current({
        type: 'OFFER',
        sender: clientUuid.current,
        payload: JSON.stringify(offer)
      });
    } catch (err) {
      console.error('Rejection in initiateCall:', err);
    }
  }, [initializePeer, setupDataChannelEvents]);

  const processIncomingSignal = useCallback(async (signal) => {
    // If the signal is sent by ourselves, skip processing
    if (signal.sender === clientUuid.current) return;

    console.log(`Processing incoming signal [${signal.type}] from ${signal.sender}`);
    const pc = peerConnection.current || initializePeer();
    const data = JSON.parse(signal.payload);

    try {
      if (signal.type === 'OFFER') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        console.log('Remote description (Offer) set, answering...');
        sendSignalRef.current({
          type: 'ANSWER',
          sender: clientUuid.current,
          payload: JSON.stringify(answer)
        });
      } else if (signal.type === 'ANSWER') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        console.log('Remote description (Answer) set successfully.');
      } else if (signal.type === 'ICE_CANDIDATE') {
        await pc.addIceCandidate(new RTCIceCandidate(data));
        console.log('Ice Candidate added successfully.');
      }
    } catch (error) {
      console.error('Error processing WebRTC Signal:', error);
    }
  }, [initializePeer]);

  const sendDirectMessage = useCallback((text) => {
    if (dataChannel.current && dataChannel.current.readyState === 'open') {
      const messageObj = {
        type: 'CHAT',
        sender: 'Peer',
        payload: text
      };
      dataChannel.current.send(JSON.stringify(messageObj));
      setReceivedMessages((prev) => [...prev, `Me: ${text}`]);
    } else {
      console.warn('Cannot send direct message: WebRTC Data Channel is not open.');
    }
  }, []);

  const sendFileMetadata = useCallback((name, size, mimeType) => {
    if (dataChannel.current && dataChannel.current.readyState === 'open') {
      setTransferFileName(name);
      setTransferFileSize(size);
      setTransferFileMimeType(mimeType || '');
      setTransferState('sending');
      setTransferProgress(0);
      startSpeedTracker();

      // Set up a promise to block chunk sending until FILE_READY is received
      fileReadyPromiseRef.current = new Promise((resolve) => {
        resolveFileReadyRef.current = resolve;
      });

      const startMsg = {
        type: 'FILE_START',
        name,
        size,
        mimeType: mimeType || ''
      };
      dataChannel.current.send(JSON.stringify(startMsg));
    }
  }, [startSpeedTracker]);

  const waitForReceiverReady = useCallback(async () => {
    if (fileReadyPromiseRef.current) {
      await fileReadyPromiseRef.current;
    }
  }, []);

  const sendFileChunk = useCallback(async (arrayBuffer) => {
    if (!dataChannel.current || dataChannel.current.readyState !== 'open') {
      throw new Error('Data channel not open');
    }

    // Keep track of sent bytes for speed tracker
    bytesAccumulated.current += arrayBuffer.byteLength;

    // Check if buffer is filled beyond safety limit (1MB)
    if (dataChannel.current.bufferedAmount > 1024 * 1024) {
      await new Promise((resolve) => {
        const checkAndResolve = () => {
          if (dataChannel.current.bufferedAmount <= 65536) { // wait until below 64KB
            dataChannel.current.removeEventListener('bufferedamountlow', checkAndResolve);
            resolve();
          }
        };
        dataChannel.current.addEventListener('bufferedamountlow', checkAndResolve);
      });
    }

    dataChannel.current.send(arrayBuffer);
  }, []);

  const completeSendingFile = useCallback(() => {
    if (dataChannel.current && dataChannel.current.readyState === 'open') {
      setTransferState('completed');
      setTransferProgress(100);
      stopSpeedTracker();

      const endMsg = { type: 'FILE_END' };
      dataChannel.current.send(JSON.stringify(endMsg));
    }
  }, [stopSpeedTracker]);

  const registerFileReceivingCallbacks = useCallback(({ onStart, onChunk, onEnd, onCancel }) => {
    fileStartCallback.current = onStart;
    fileChunkCallback.current = onChunk;
    fileEndCallback.current = onEnd;
    fileCancelCallback.current = onCancel;
  }, []);

  return {
    clientUuid: clientUuid.current,
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
    receivedMessages,
    connectionState,
    transferProgress,
    transferSpeed,
    transferState,
    transferFileName,
    transferFileSize,
    transferFileMimeType
  };
};

export default useWebRTC;
