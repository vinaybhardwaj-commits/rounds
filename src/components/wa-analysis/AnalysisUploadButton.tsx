'use client';

// ============================================
// AnalysisUploadButton — File picker for WhatsApp exports
// Super admin only. Accepts .txt files, max 5MB.
// Phase: WA.2
// ============================================

import React, { useRef, useState } from 'react';
import { Upload, FileText, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import type { AnalysisCardPayload } from '@/lib/wa-engine/types';

interface UploadResult {
  success: boolean;
  data?: AnalysisCardPayload;
  error?: string;
  meta?: { system_messages_skipped: number; total_lines_in_file: number };
}

interface AnalysisUploadButtonProps {
  onUploadComplete?: (result: UploadResult) => void;
}

export default function AnalysisUploadButton({ onUploadComplete }: AnalysisUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);

    if (!file.name.endsWith('.txt')) {
      setError('Only .txt files are accepted. Please export your WhatsApp chat as a text file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`);
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch('/api/wa-analysis/upload', {
        method: 'POST',
        body: formData,
      });

      const data: UploadResult = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Upload failed');
        setResult(null);
      } else {
        setResult(data);
        setSelectedFile(null);
        if (inputRef.current) inputRef.current.value = '';
      }

      onUploadComplete?.(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setError(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
          <Upload size={20} className="text-green-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Upload WhatsApp Export</h3>
          <p className="text-xs text-gray-500">
            .txt file from WhatsApp &quot;Export Chat&quot; (without media), max 5MB
          </p>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".txt"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* File selection area */}
      {!selectedFile && !result && (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed border-gray-200 rounded-lg p-6 text-center
                     hover:border-green-300 hover:bg-green-50/50 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FileText size={24} className="mx-auto mb-2 text-gray-400" />
          <span className="text-sm text-gray-600">Click to select a WhatsApp export file</span>
        </button>
      )}

      {/* Selected file + upload button */}
      {selectedFile && !result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
            <FileText size={18} className="text-green-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{selectedFile.name}</p>
              <p className="text-xs text-gray-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              onClick={handleReset}
              className="text-gray-400 hover:text-gray-600 p-1"
              title="Remove file"
            >
              ×
            </button>
          </div>
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="w-full bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium
                       hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2 transition-colors"
          >
            {uploading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Upload size={16} />
                Upload &amp; Analyze
              </>
            )}
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mt-3 flex items-start gap-2 bg-red-50 text-red-700 rounded-lg p-3">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Success result */}
      {result?.data && (
        <div className="mt-3">
          {result.data.status === 'no_new_messages' ? (
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle size={16} className="text-blue-600" />
                <span className="text-sm font-medium text-blue-900">Already Analyzed</span>
              </div>
              <p className="text-sm text-blue-700">
                All {result.data.total_parsed} messages in this export have already been processed.
                No new data to extract.
              </p>
            </div>
          ) : (
            <div className="bg-green-50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle size={16} className="text-green-600" />
                <span className="text-sm font-medium text-green-900">Upload Successful</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-gray-600">Messages parsed:</div>
                <div className="font-medium text-gray-900">{result.data.total_parsed}</div>
                <div className="text-gray-600">New messages:</div>
                <div className="font-medium text-green-700">{result.data.new_processed}</div>
                <div className="text-gray-600">Duplicates skipped:</div>
                <div className="font-medium text-gray-500">{result.data.duplicates_skipped}</div>
                {result.data.date_range && (
                  <>
                    <div className="text-gray-600">Date range:</div>
                    <div className="font-medium text-gray-900">
                      {result.data.date_range.start} → {result.data.date_range.end}
                    </div>
                  </>
                )}
                <div className="text-gray-600">Processing time:</div>
                <div className="font-medium text-gray-900">{result.data.processing_time_ms}ms</div>
              </div>
              {result.data.source_group && (
                <p className="mt-2 text-xs text-gray-500">
                  Group: {result.data.source_group}
                </p>
              )}
            </div>
          )}
          <button
            onClick={handleReset}
            className="mt-3 w-full text-sm text-gray-500 hover:text-gray-700 py-1"
          >
            Upload another file
          </button>
        </div>
      )}
    </div>
  );
}
