'use client';

import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Download } from 'lucide-react';
import type { CSVImportResult } from '@/types';

export function CSVImport() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<CSVImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/profiles/import', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        setResult(data.data);
      } else {
        setError(data.error || 'Import failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    // Download the pre-built XLSX template from /public
    const a = document.createElement('a');
    a.href = '/rounds-staff-import-template.xlsx';
    a.download = 'rounds-staff-import-template.xlsx';
    a.click();
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-even-navy mb-2">Import Staff Profiles</h1>
      <p className="text-sm text-gray-500 mb-6">
        Upload a CSV or XLSX file with staff data to bulk-create or update profiles.
      </p>

      {/* Expected format + Template download side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 mb-6">
        {/* Left: Expected columns */}
        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Expected columns</h3>
          <div className="text-xs text-gray-500 space-y-1">
            <p><strong>email</strong> (required) &mdash; @even.in for internal staff</p>
            <p><strong>full_name</strong> (required) &mdash; Staff member&apos;s full name</p>
            <p><strong>department</strong> &mdash; Department slug or name</p>
            <p><strong>role</strong> &mdash; staff, doctor, nurse, department_head, etc.</p>
            <p><strong>designation</strong> &mdash; Job title (optional)</p>
            <p><strong>phone</strong> &mdash; Phone number (optional)</p>
          </div>
        </div>

        {/* Right: Template download card */}
        <button
          onClick={downloadTemplate}
          className="flex flex-col items-center justify-center gap-2 bg-even-blue/5 border-2 border-dashed border-even-blue/30 rounded-xl px-6 py-5 hover:bg-even-blue/10 hover:border-even-blue/50 transition-colors cursor-pointer text-center min-w-[180px]"
        >
          <Download size={28} className="text-even-blue" />
          <span className="text-sm font-semibold text-even-navy">Download Template</span>
          <span className="text-[11px] text-gray-500 leading-tight">
            XLSX file with dropdowns.<br />Fill it in, then upload<br />it back here.
          </span>
        </button>
      </div>

      {/* Upload area */}
      <div
        onClick={() => inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
          ${file ? 'border-even-blue bg-even-blue/5' : 'border-gray-200 hover:border-gray-300'}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setResult(null);
            setError(null);
          }}
        />
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileText size={24} className="text-even-blue" />
            <div className="text-left">
              <p className="text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
          </div>
        ) : (
          <>
            <Upload size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">Click to select a CSV or XLSX file</p>
            <p className="text-xs text-gray-400 mt-1">or drag and drop</p>
          </>
        )}
      </div>

      {/* Upload button */}
      <button
        onClick={handleUpload}
        disabled={!file || uploading}
        className="mt-4 w-full py-3 bg-even-blue text-white rounded-xl font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {uploading ? 'Importing...' : 'Import Profiles'}
      </button>

      {/* Result */}
      {result && (
        <div className="mt-6 bg-green-50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={18} className="text-green-600" />
            <span className="font-semibold text-green-800">Import Complete</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-900">{result.total}</div>
              <div className="text-xs text-gray-500">Total Rows</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{result.created}</div>
              <div className="text-xs text-gray-500">Created</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">{result.updated}</div>
              <div className="text-xs text-gray-500">Updated</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-orange-500">{result.skipped}</div>
              <div className="text-xs text-gray-500">Skipped</div>
            </div>
          </div>

          {/* Errors */}
          {result.errors.length > 0 && (
            <div className="mt-4 border-t border-green-200 pt-3">
              <p className="text-xs font-semibold text-red-600 mb-2">Errors ({result.errors.length}):</p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {result.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-600">
                    Row {err.row} ({err.email}): {err.error}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-6 bg-red-50 rounded-xl p-5 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-600 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800">Import Failed</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
