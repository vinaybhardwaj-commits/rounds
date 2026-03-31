'use client';

// ============================================
// PatientFilesTab — Files tab for PatientDetailView.
// Upload, list, search, preview, download, and
// manage files linked to a patient.
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload,
  FileText,
  Image,
  FileSpreadsheet,
  File,
  Search,
  Download,
  Trash2,
  Eye,
  X,
  ChevronDown,
  Paperclip,
  AlertCircle,
  CheckCircle,
  Loader2,
} from 'lucide-react';

// ── Types ──
interface PatientFile {
  id: string;
  file_id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  blob_url: string;
  category: string;
  description: string | null;
  tags: string[];
  uploaded_by_name: string | null;
  link_context: string;
  notes: string | null;
  linked_by_name: string | null;
  file_created_at: string;
  linked_at: string;
}

interface PatientFilesTabProps {
  patientId: string;
  patientName: string;
}

// ── Helpers ──
const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'lab_report', label: 'Lab Report' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'consent_form', label: 'Consent Form' },
  { value: 'discharge_summary', label: 'Discharge Summary' },
  { value: 'imaging', label: 'Imaging / X-Ray' },
  { value: 'id_document', label: 'ID Document' },
  { value: 'billing', label: 'Billing' },
  { value: 'referral', label: 'Referral' },
  { value: 'other', label: 'Other' },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <Image size={18} className="text-purple-500" />;
  if (mimeType === 'application/pdf') return <FileText size={18} className="text-red-500" />;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv')
    return <FileSpreadsheet size={18} className="text-green-600" />;
  if (mimeType.includes('word') || mimeType.includes('document'))
    return <FileText size={18} className="text-blue-600" />;
  return <File size={18} className="text-gray-400" />;
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    insurance: 'bg-blue-100 text-blue-700',
    lab_report: 'bg-purple-100 text-purple-700',
    prescription: 'bg-green-100 text-green-700',
    consent_form: 'bg-amber-100 text-amber-700',
    discharge_summary: 'bg-teal-100 text-teal-700',
    imaging: 'bg-indigo-100 text-indigo-700',
    id_document: 'bg-gray-100 text-gray-700',
    billing: 'bg-orange-100 text-orange-700',
    referral: 'bg-pink-100 text-pink-700',
  };
  return colors[category] || 'bg-gray-100 text-gray-600';
}

export function PatientFilesTab({ patientId, patientName }: PatientFilesTabProps) {
  const [files, setFiles] = useState<PatientFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [previewFile, setPreviewFile] = useState<PatientFile | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState('general');
  const [uploadDescription, setUploadDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCategory) params.set('category', filterCategory);
      if (search) params.set('search', search);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/patients/${patientId}/files${qs}`);
      const data = await res.json();
      if (data.success) setFiles(data.data || []);
    } catch (err) {
      console.error('Failed to fetch files:', err);
    } finally {
      setLoading(false);
    }
  }, [patientId, filterCategory, search]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  // ── Upload handler ──
  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('patient_thread_id', patientId);
      formData.append('category', uploadCategory);
      if (uploadDescription) formData.append('description', uploadDescription);
      formData.append('link_context', 'upload');

      const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.success) {
        showToast('success', `${uploadFile.name} uploaded successfully`);
        setUploadFile(null);
        setUploadCategory('general');
        setUploadDescription('');
        setShowUpload(false);
        fetchFiles();
      } else {
        showToast('error', data.error || 'Upload failed');
      }
    } catch {
      showToast('error', 'Network error during upload');
    } finally {
      setUploading(false);
    }
  };

  // ── Unlink handler ──
  const handleUnlink = async (fileId: string, filename: string) => {
    if (!confirm(`Unlink "${filename}" from ${patientName}? The file itself won't be deleted.`)) return;

    try {
      const res = await fetch(`/api/patients/${patientId}/files?file_id=${fileId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('success', 'File unlinked');
        fetchFiles();
      } else {
        showToast('error', data.error || 'Failed to unlink');
      }
    } catch {
      showToast('error', 'Network error');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Toast ── */}
      {msg && (
        <div className={`mx-4 mt-3 p-2.5 rounded-lg flex items-center gap-2 text-xs ${
          msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {msg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {msg.text}
        </div>
      )}

      {/* ── Search + Filter + Upload bar ── */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search files..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-even-blue outline-none"
            />
          </div>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-even-blue text-white rounded-lg text-xs font-medium hover:bg-even-blue/90 transition-colors shrink-0"
          >
            <Upload size={14} /> Upload
          </button>
        </div>

        {/* Category filter pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <button
            onClick={() => setFilterCategory('')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              !filterCategory ? 'bg-even-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => setFilterCategory(filterCategory === cat.value ? '' : cat.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                filterCategory === cat.value ? 'bg-even-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── File List ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-even-blue/40" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12">
            <Paperclip size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-500 mb-1">No files yet</p>
            <p className="text-xs text-gray-400">Upload files to keep all patient documents in one place.</p>
            <button
              onClick={() => setShowUpload(true)}
              className="mt-4 px-4 py-2 bg-even-blue text-white rounded-lg text-xs font-medium"
            >
              Upload First File
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-400 mb-1">{files.length} file{files.length !== 1 ? 's' : ''}</p>
            {files.map(file => (
              <div
                key={file.id}
                className="bg-white rounded-xl border border-gray-100 p-3 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">{getFileIcon(file.mime_type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-even-navy truncate">
                        {file.original_filename}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${getCategoryColor(file.category)}`}>
                        {CATEGORIES.find(c => c.value === file.category)?.label || file.category}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 flex items-center gap-2 flex-wrap">
                      <span>{formatFileSize(file.size_bytes)}</span>
                      {file.uploaded_by_name && <span>by {file.uploaded_by_name}</span>}
                      <span>{new Date(file.file_created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                    {file.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-1">{file.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Preview (images and PDFs) */}
                    {(file.mime_type.startsWith('image/') || file.mime_type === 'application/pdf') && (
                      <button
                        onClick={() => setPreviewFile(file)}
                        className="p-1.5 text-gray-400 hover:text-even-blue hover:bg-blue-50 rounded-lg transition-colors"
                        title="Preview"
                      >
                        <Eye size={14} />
                      </button>
                    )}
                    {/* Download */}
                    <a
                      href={file.blob_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                      title="Download"
                    >
                      <Download size={14} />
                    </a>
                    {/* Unlink */}
                    <button
                      onClick={() => handleUnlink(file.file_id, file.original_filename)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Unlink from patient"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Upload Modal ── */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:w-[90%] sm:max-w-md mx-0 sm:mx-4 shadow-xl overflow-hidden max-h-[80vh] flex flex-col">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-gray-100">
              <h3 className="text-base font-semibold text-even-navy">Upload File</h3>
              <button onClick={() => { setShowUpload(false); setUploadFile(null); }} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="px-5 py-4 flex-1 overflow-y-auto space-y-4">
              {/* File picker */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) setUploadFile(f);
                  }}
                />
                {uploadFile ? (
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    {getFileIcon(uploadFile.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-even-navy truncate">{uploadFile.name}</p>
                      <p className="text-xs text-gray-400">{formatFileSize(uploadFile.size)}</p>
                    </div>
                    <button onClick={() => setUploadFile(null)} className="p-1 text-gray-400 hover:text-red-500">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full p-6 border-2 border-dashed border-gray-200 rounded-xl text-center hover:border-even-blue/40 hover:bg-blue-50/30 transition-colors"
                  >
                    <Upload size={24} className="mx-auto text-gray-400 mb-2" />
                    <p className="text-sm text-gray-500">Tap to select a file</p>
                    <p className="text-xs text-gray-400 mt-1">PDF, Images, Office docs up to 50MB</p>
                  </button>
                )}
              </div>

              {/* Category */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Category</label>
                <div className="relative">
                  <select
                    value={uploadCategory}
                    onChange={e => setUploadCategory(e.target.value)}
                    className="w-full appearance-none px-3 py-2 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-even-blue outline-none"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Description (optional)</label>
                <textarea
                  value={uploadDescription}
                  onChange={e => setUploadDescription(e.target.value)}
                  rows={2}
                  placeholder="e.g. Insurance policy document for TPA"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue outline-none resize-none"
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100">
              <button
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
                className="w-full py-3 bg-even-blue text-white rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Uploading...
                  </>
                ) : (
                  <>
                    <Upload size={16} /> Upload File
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview Modal ── */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPreviewFile(null)}>
          <div className="bg-white rounded-2xl w-[95%] max-w-2xl max-h-[85vh] shadow-xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center gap-2 min-w-0">
                {getFileIcon(previewFile.mime_type)}
                <span className="text-sm font-medium text-even-navy truncate">{previewFile.original_filename}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={previewFile.blob_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                >
                  <Download size={16} />
                </a>
                <button onClick={() => setPreviewFile(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-gray-50 flex items-center justify-center">
              {previewFile.mime_type.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewFile.blob_url}
                  alt={previewFile.original_filename}
                  className="max-w-full max-h-[70vh] object-contain rounded-lg"
                />
              ) : previewFile.mime_type === 'application/pdf' ? (
                <iframe
                  src={previewFile.blob_url}
                  className="w-full h-[70vh] rounded-lg border border-gray-200"
                  title={previewFile.original_filename}
                />
              ) : (
                <p className="text-gray-500 text-sm">Preview not available for this file type.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
