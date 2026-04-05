'use client';

// ============================================
// FCVersionHistory — Financial Counselling
// version history timeline for a patient.
// Shows all FC form submissions with PDF
// download/generate buttons, change reasons,
// payment mode, estimated cost.
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Download,
  Lock,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';

interface FCFormVersion {
  id: string;
  version_number: number | null;
  submitted_by_name: string | null;
  created_at: string;
  change_reason: string | null;
  status: string;
  locked: boolean;
  pdf_blob_url: string | null;
  form_data: Record<string, unknown>;
}

interface FCVersionHistoryProps {
  patientThreadId: string;
  onOpenForm?: (formId: string) => void;
}

function formatIndianCurrency(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : (value as number);
  if (isNaN(num)) return '—';
  return `₹${num.toLocaleString('en-IN')}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function FCVersionHistory({
  patientThreadId,
  onOpenForm,
}: FCVersionHistoryProps) {
  const router = useRouter();
  const [versions, setVersions] = useState<FCFormVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingPDF, setGeneratingPDF] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch FC version history
  const fetchVersions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(
        `/api/forms?form_type=financial_counseling&patient_thread_id=${patientThreadId}`
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch FC versions: ${res.statusText}`);
      }

      const data = await res.json();
      const forms = data.data || [];

      // Sort by created_at descending (newest first)
      const sorted = forms.sort(
        (a: FCFormVersion, b: FCFormVersion) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setVersions(sorted);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to load version history';
      setError(errMsg);
      console.error('FCVersionHistory fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [patientThreadId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  // Generate PDF for a form
  const handleGeneratePDF = async (formId: string) => {
    try {
      setGeneratingPDF((prev) => new Set([...prev, formId]));
      setMsg(null);

      const res = await fetch(`/api/forms/${formId}/pdf`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to generate PDF: ${res.statusText}`);
      }

      const data = await res.json();
      setMsg({ type: 'success', text: 'PDF generated successfully' });

      // Refresh versions to show new PDF URL
      await fetchVersions();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to generate PDF';
      setMsg({ type: 'error', text: errMsg });
      console.error('PDF generation error:', err);
    } finally {
      setGeneratingPDF((prev) => {
        const next = new Set(prev);
        next.delete(formId);
        return next;
      });
    }
  };

  // Download/open PDF
  const handleDownloadPDF = (pdfUrl: string) => {
    window.open(pdfUrl, '_blank');
  };

  // Open FC form for new submission
  const handleNewFC = () => {
    if (onOpenForm) {
      onOpenForm('financial_counseling');
    } else {
      // Default: navigate to form renderer for this patient
      router.push(`/patients/${patientThreadId}/forms/financial_counseling`);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="text-center text-gray-500">
          Loading Financial Counselling history...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-800">Failed to load history</h3>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      {/* Header + New button */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Financial Counselling</h2>
          <p className="text-sm text-gray-500 mt-1">
            {versions.length === 0
              ? 'No submissions yet'
              : `${versions.length} submission${versions.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={handleNewFC}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm font-medium">New</span>
        </button>
      </div>

      {/* Status message */}
      {msg && (
        <div
          className={`mb-4 p-3 rounded-md text-sm font-medium flex items-center gap-2 ${
            msg.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {msg.type === 'success' ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {msg.text}
        </div>
      )}

      {/* Timeline list */}
      {versions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No Financial Counselling submissions yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {versions.map((version, idx) => {
            const versionNum = version.version_number || idx + 1;
            const fd = version.form_data || {};
            const paymentMode = fd.payment_mode as string;
            const insurerName = fd.insurance_provider as string;
            const estimatedCost = fd.estimated_cost;
            const isGeneratingPDF = generatingPDF.has(version.id);

            return (
              <div
                key={version.id}
                className="p-4 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 transition-colors"
              >
                {/* Version header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100">
                      <span className="text-sm font-semibold text-blue-700">v{versionNum}</span>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">
                        Version {versionNum}
                        {version.locked && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-gray-600">
                            <Lock className="h-3 w-3" />
                            Locked
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {formatDate(version.created_at)}
                      </div>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div
                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      version.status === 'submitted'
                        ? 'bg-blue-100 text-blue-700'
                        : version.status === 'reviewed'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {version.status === 'submitted' && 'Submitted'}
                    {version.status === 'reviewed' && 'Reviewed'}
                    {version.status === 'draft' && 'Draft'}
                    {!['submitted', 'reviewed', 'draft'].includes(version.status) &&
                      version.status}
                  </div>
                </div>

                {/* Metadata */}
                <div className="text-sm text-gray-600 mb-3 space-y-1">
                  {version.submitted_by_name && (
                    <div>
                      <span className="font-medium">Submitted by:</span>{' '}
                      {version.submitted_by_name}
                    </div>
                  )}
                  {version.change_reason && (
                    <div>
                      <span className="font-medium">Reason for change:</span>{' '}
                      {version.change_reason}
                    </div>
                  )}
                </div>

                {/* Financial details */}
                <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                  {paymentMode && (
                    <div>
                      <span className="text-gray-600">Payment Mode</span>
                      <div className="font-semibold text-gray-900 capitalize">
                        {paymentMode.replace(/_/g, ' ')}
                      </div>
                    </div>
                  )}
                  {insurerName && (
                    <div>
                      <span className="text-gray-600">Insurer</span>
                      <div className="font-semibold text-gray-900">{insurerName}</div>
                    </div>
                  )}
                  {estimatedCost && (
                    <div>
                      <span className="text-gray-600">Estimated Cost</span>
                      <div className="font-semibold text-gray-900">
                        {formatIndianCurrency(estimatedCost)}
                      </div>
                    </div>
                  )}
                </div>

                {/* PDF actions */}
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                  {version.pdf_blob_url ? (
                    <button
                      onClick={() => handleDownloadPDF(version.pdf_blob_url!)}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      Download PDF
                    </button>
                  ) : !version.locked ? (
                    <button
                      onClick={() => handleGeneratePDF(version.id)}
                      disabled={isGeneratingPDF}
                      className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        isGeneratingPDF
                          ? 'bg-gray-100 text-gray-600 cursor-not-allowed'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {isGeneratingPDF ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <FileText className="h-4 w-4" />
                          Generate PDF
                        </>
                      )}
                    </button>
                  ) : null}

                  {version.locked && (
                    <div className="text-xs text-gray-500">
                      <Lock className="h-3 w-3 inline mr-1" />
                      This version is locked and immutable
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
