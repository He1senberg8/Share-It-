import React, { useState } from 'react';

export default function FileProcessor() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [reconstructedUrl, setReconstructedUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const CHUNK_SIZE = 64 * 1024; // 64 KB in bytes

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
    setChunks([]);
    setReconstructedUrl('');
  };

  // SIMULATION: Shred the file into separate binary ArrayBuffers using modern Blob.arrayBuffer()
  const sliceFileIntoChunks = async () => {
    if (!selectedFile) return;
    
    setIsProcessing(true);
    const fileChunks = [];
    const totalSize = selectedFile.size;

    // Using async/await in a standard loop makes this exceptionally clean
    for (let currentByte = 0; currentByte < totalSize; currentByte += CHUNK_SIZE) {
      // 1. Slice the raw blob down to size
      const fileSlice = selectedFile.slice(currentByte, currentByte + CHUNK_SIZE);
      
      // 2. Await the Promise to get the raw binary ArrayBuffer
      const arrayBuffer = await fileSlice.arrayBuffer();
      
      fileChunks.push(arrayBuffer);
    }

    console.log(`Finished slicing! Total chunks created: ${fileChunks.length}`);
    setChunks(fileChunks);
    setIsProcessing(false);
  };

  // SIMULATION: Merge the isolated ArrayBuffers back into a single functional file
  const mergeChunksAndDownload = () => {
    if (chunks.length === 0) return;

    // Convert individual ArrayBuffers into a unified Blob array
    const reconstitutedBlob = new Blob(chunks, { type: selectedFile.type });
    
    // Generate a temporary browser download string URL
    const downloadUrl = URL.createObjectURL(reconstitutedBlob);
    setReconstructedUrl(downloadUrl);
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white shadow rounded-lg space-y-4 border border-gray-200">
      <h2 className="text-xl font-bold text-gray-800">Binary Processing Lab</h2>
      <p className="text-sm text-gray-500">
        Simulate file slicing and local data rebuilding before adding the network.
      </p>

      <input
        type="file"
        onChange={handleFileChange}
        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
      />

      {selectedFile && (
        <div className="bg-gray-50 p-3 rounded text-xs space-y-1">
          <div><strong>Name:</strong> {selectedFile.name}</div>
          <div><strong>Size:</strong> {(selectedFile.size / 1024).toFixed(2)} KB</div>
          <div><strong>Expected Chunks:</strong> {Math.ceil(selectedFile.size / CHUNK_SIZE)}</div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={sliceFileIntoChunks}
          disabled={!selectedFile || isProcessing}
          className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-md disabled:bg-gray-300 w-full"
        >
          {isProcessing ? 'Slicing...' : '1. Shred File'}
        </button>
        <button
          onClick={mergeChunksAndDownload}
          disabled={chunks.length === 0}
          className="bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-md disabled:bg-gray-300 w-full"
        >
          2. Merge Chunks
        </button>
      </div>

      {chunks.length > 0 && (
        <div className="text-xs text-green-700 bg-green-50 p-2 rounded">
          Successfully processed <strong>{chunks.length}</strong> raw binary memory blocks!
        </div>
      )}

      {reconstructedUrl && (
        <div className="pt-2">
          <a
            href={reconstructedUrl}
            download={`reconstructed_${selectedFile?.name}`}
            className="block text-center bg-gray-900 text-white text-sm font-medium py-2 rounded-md hover:bg-gray-800"
          >
            Download Processed File
          </a>
        </div>
      )}
    </div>
  );
}