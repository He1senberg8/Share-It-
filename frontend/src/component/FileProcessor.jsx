import React, { useState, useEffect, useRef } from 'react';

export default function FileProcessor({
  sendFileMetadata,
  waitForReceiverReady,
  sendFileChunk,
  completeSendingFile,
  registerFileReceivingCallbacks,
  acceptIncomingFile,
  declineIncomingFile,
  cancelFileTransfer,
  transferProgress,
  transferSpeed,
  transferState,
  transferFileName,
  transferFileSize,
  transferFileMimeType,
  connectionState
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [savingMode, setSavingMode] = useState(''); // 'Disk (Direct)' | 'IndexedDB (Buffer)'
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const writableStream = useRef(null);
  const indexedDbInstance = useRef(null);
  const useFileSystem = useRef(false);
  const fileInputRef = useRef(null);

  const CHUNK_SIZE = 16384 * 4; // 64 KB binary chunks
  const isFileSystemAccessSupported = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

  // Initialize receiving callbacks
  useEffect(() => {
    registerFileReceivingCallbacks({
      onStart: handleFileReceiveStart,
      onChunk: handleFileReceiveChunk,
      onEnd: handleFileReceiveEnd,
      onCancel: handleFileReceiveCancel
    });
  }, [registerFileReceivingCallbacks]);

  // IndexedDB Helpers
  const initIndexedDB = () => {
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase('NexusShareDB');
      deleteRequest.onsuccess = () => {
        const request = indexedDB.open('NexusShareDB', 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          db.createObjectStore('chunks', { autoIncrement: true });
        };
        request.onsuccess = (e) => {
          indexedDbInstance.current = e.target.result;
          resolve();
        };
        request.onerror = (e) => reject(e.target.error);
      };
      deleteRequest.onerror = (e) => reject(e.target.error);
    });
  };

  const saveChunkToIndexedDB = (chunk) => {
    return new Promise((resolve, reject) => {
      if (!indexedDbInstance.current) {
        reject(new Error('IndexedDB not initialized'));
        return;
      }
      try {
        const transaction = indexedDbInstance.current.transaction('chunks', 'readwrite');
        const store = transaction.objectStore('chunks');
        const request = store.add(chunk);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      } catch (err) {
        reject(err);
      }
    });
  };

  const assembleIndexedDBFile = (fileName) => {
    return new Promise((resolve, reject) => {
      if (!indexedDbInstance.current) {
        reject(new Error('IndexedDB not initialized'));
        return;
      }
      const transaction = indexedDbInstance.current.transaction('chunks', 'readonly');
      const store = transaction.objectStore('chunks');
      const request = store.getAll();

      request.onsuccess = () => {
        const chunks = request.result;
        
        // Use the exact original MIME type of the file sent
        const blob = new Blob(chunks, { type: transferFileMimeType || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  };

  const cleanupStorage = async () => {
    try {
      if (writableStream.current) {
        await writableStream.current.abort().catch(() => {});
        writableStream.current = null;
      }
      if (indexedDbInstance.current) {
        indexedDbInstance.current.close();
        indexedDbInstance.current = null;
      }
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('NexusShareDB');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
      setSavingMode('');
    } catch (err) {
      console.error('Storage cleanup failed:', err);
    }
  };

  // WebRTC Receiver Callbacks
  const handleFileReceiveStart = async ({ name, size }) => {
    setErrorMessage('');
    if (isFileSystemAccessSupported) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name
        });
        const stream = await handle.createWritable();
        writableStream.current = stream;
        useFileSystem.current = true;
        setSavingMode('Disk (Direct)');
      } catch (err) {
        console.warn('Direct disk stream cancelled or denied. Falling back to IndexedDB.', err);
        useFileSystem.current = false;
        setSavingMode('IndexedDB (Buffer)');
        await initIndexedDB();
      }
    } else {
      useFileSystem.current = false;
      setSavingMode('IndexedDB (Buffer)');
      await initIndexedDB();
    }
  };

  const handleFileReceiveChunk = async (chunk) => {
    try {
      if (useFileSystem.current && writableStream.current) {
        await writableStream.current.write(chunk);
      } else {
        await saveChunkToIndexedDB(chunk);
      }
    } catch (err) {
      console.error('Failed to write file chunk:', err);
      setErrorMessage('Write Error: Failed to write chunk.');
    }
  };

  const handleFileReceiveEnd = async () => {
    try {
      if (useFileSystem.current && writableStream.current) {
        await writableStream.current.close();
        writableStream.current = null;
      } else {
        await assembleIndexedDBFile(transferFileName);
      }
    } catch (err) {
      console.error('Failed to finalize file transfer:', err);
      setErrorMessage('Failed to compile downloaded file.');
    } finally {
      await cleanupStorage();
    }
  };

  const handleFileReceiveCancel = async () => {
    setErrorMessage('File transfer cancelled by remote peer.');
    await cleanupStorage();
  };

  // WebRTC Sender Actions
  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setErrorMessage('');
    }
  };

  const startFileTransfer = async () => {
    if (!selectedFile) return;
    setIsSending(true);
    setErrorMessage('');

    try {
      // Pass the original file's MIME type to the metadata
      sendFileMetadata(selectedFile.name, selectedFile.size, selectedFile.type);
      
      console.log('Waiting for remote storage to be ready...');
      await waitForReceiverReady();
      console.log('Remote storage ready. Slicing file and transmitting...');

      let offset = 0;
      while (offset < selectedFile.size) {
        const slice = selectedFile.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await slice.arrayBuffer();
        await sendFileChunk(arrayBuffer);
        offset += CHUNK_SIZE;
      }

      completeSendingFile();
    } catch (err) {
      console.error('File transmission failed:', err);
      setErrorMessage('Transfer aborted: ' + err.message);
    } finally {
      setIsSending(false);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Drag and Drop Handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (transferState === 'receiving' || transferState === 'awaiting_acceptance' || isSending) return;

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
      setErrorMessage('');
    }
  };

  const handleCancelClick = async () => {
    await cancelFileTransfer();
    await cleanupStorage();
    setIsSending(false);
    setSelectedFile(null);
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isConnected = connectionState === 'connected';
  const isTransferring = transferState === 'sending' || transferState === 'receiving';

  return (
    <div className="flex flex-col gap-6 font-mono text-xs">
      
      {/* Drag & Drop Zone */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest font-mono">
          File Sharing Station
        </label>
        
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => isConnected && !isTransferring && fileInputRef.current.click()}
          className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-all duration-300 ${
            isConnected && !isTransferring ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'
          } ${
            isDragging 
              ? 'border-white bg-slate-900/60 shadow-[0_0_15px_rgba(255,255,255,0.05)]' 
              : 'border-slate-800 bg-[#0e0e0e] hover:border-slate-700 hover:bg-[#121212]'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            disabled={!isConnected || isSending || isTransferring}
            className="hidden"
          />
          
          <div className="w-10 h-10 rounded-full border border-slate-800 flex items-center justify-center bg-[#070707]">
            <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          
          <div className="text-center flex flex-col gap-1">
            <span className="text-neutral-300 font-bold text-[11px]">
              {selectedFile ? 'File selected' : 'DRAG & DROP FILE HERE'}
            </span>
            <span className="text-[10px] text-neutral-500">
              {selectedFile ? selectedFile.name : 'or click to browse local storage'}
            </span>
          </div>
        </div>
      </div>

      {/* Selected File Box / Send Controls */}
      {selectedFile && (
        <div className="bg-neutral-950 border border-slate-850 p-4 rounded-xl flex items-center justify-between transition-all duration-300 shadow-lg">
          <div className="flex flex-col gap-1 truncate max-w-[70%]">
            <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-wider">SELECTED FILE</span>
            <span className="text-white font-medium truncate text-xs">{selectedFile.name}</span>
            <span className="text-[10px] text-neutral-500">{formatBytes(selectedFile.size)}</span>
          </div>

          <button
            onClick={startFileTransfer}
            disabled={!isConnected || isSending || isTransferring}
            className="bg-white hover:bg-neutral-200 disabled:bg-neutral-950 disabled:border-neutral-900 disabled:text-neutral-800 border border-transparent text-black font-bold uppercase text-[10px] tracking-wider px-5 py-2.5 rounded-lg transition-all duration-200 cursor-pointer disabled:cursor-not-allowed shadow-md"
          >
            {isSending ? 'SENDING' : 'SHARE FILE'}
          </button>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="bg-red-950/20 border border-red-900/50 p-4 rounded-xl text-red-400">
          {errorMessage}
        </div>
      )}

      {/* Accept Transfer Prompt */}
      {transferState === 'awaiting_acceptance' && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 flex flex-col gap-4 text-neutral-200">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wider">
              Incoming P2P Transfer Invitation
            </span>
            <span className="text-white font-medium truncate max-w-md mt-0.5">{transferFileName}</span>
            <span className="text-[10px] text-neutral-400">File size: {formatBytes(transferFileSize)}</span>
          </div>

          <div className="flex gap-3">
            <button
              onClick={acceptIncomingFile}
              className="flex-1 bg-white hover:bg-neutral-200 text-black text-xs font-bold py-2 rounded-lg transition-all duration-200 cursor-pointer font-mono"
            >
              ACCEPT AND SAVE
            </button>
            <button
              onClick={declineIncomingFile}
              className="flex-1 bg-transparent hover:bg-neutral-950 border border-neutral-850 hover:border-neutral-800 text-neutral-400 hover:text-white text-xs font-bold py-2 rounded-lg transition-all duration-200 cursor-pointer font-mono"
            >
              DECLINE
            </button>
          </div>
        </div>
      )}

      {/* Live Transfer Console */}
      {isTransferring && (
        <div className="bg-[#0e0e0e] border border-slate-900 rounded-xl p-5 flex flex-col gap-4">
          <div className="flex justify-between items-center pb-2 border-b border-neutral-900">
            <div className="flex flex-col">
              <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
                {transferState === 'sending' ? 'OUTBOUND STREAM' : 'INBOUND STREAM'}
              </span>
              <span className="text-white font-medium truncate max-w-[240px] mt-0.5 text-xs">{transferFileName}</span>
            </div>
            <div className="text-right">
              <span className="text-neutral-300 font-bold block">{transferSpeed}</span>
              <span className="text-[10px] text-neutral-500">{formatBytes(transferFileSize)}</span>
            </div>
          </div>

          {/* Progress Indicator */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[10px] font-bold text-neutral-400">
              <span>PROGRESS</span>
              <span>{transferProgress.toFixed(1)}%</span>
            </div>
            <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden border border-neutral-900">
              <div
                className="h-full bg-white transition-all duration-100"
                style={{ width: `${transferProgress}%` }}
              ></div>
            </div>
          </div>

          <div className="flex gap-4 justify-between items-center pt-2 border-t border-neutral-900">
            {transferState === 'receiving' && savingMode ? (
              <div className="flex items-center gap-1.5 text-[9px] text-neutral-500 font-bold">
                <span>STORAGE ENGINE:</span>
                <span className="text-white bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800">
                  {savingMode}
                </span>
              </div>
            ) : (
              <div></div>
            )}
            
            <button
              onClick={handleCancelClick}
              className="text-red-400 hover:text-red-300 bg-red-950/20 hover:bg-red-950/40 border border-red-900/30 px-3.5 py-1.5 rounded-md font-bold text-[10px] uppercase transition-all duration-200 cursor-pointer"
            >
              CANCEL TRANSFER
            </button>
          </div>
        </div>
      )}

      {/* Completion Indicator */}
      {transferState === 'completed' && (
        <div className="bg-emerald-950/20 border border-emerald-900/40 p-4 rounded-xl text-emerald-400 font-bold text-center">
          FILE STREAM FINISHED SUCCESSFULLY
        </div>
      )}
    </div>
  );
}