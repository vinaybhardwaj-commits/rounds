'use client';

// ============================================
// /forms/new?type=surgery_posting&patient_id=xxx
// Dynamic form submission page.
// Reads schema from registry, renders form,
// submits via POST /api/forms.
// ============================================

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';
import FormRenderer from '@/components/forms/FormRenderer';
import {
  FORM_REGISTRY,
  FORM_TYPE_LABELS,
  type FormSchema,
} from '@/lib/form-registry';
import type { FormType } from '@/types';

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export default function NewFormPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Loading form...</p></div>}>
      <NewFormPage />
    </Suspense>
  );
}

function NewFormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const formType = searchParams.get('type') as FormType | null;
  const patientId = searchParams.get('patient_id') || searchParams.get('patient');
  const channelType = searchParams.get('channel_type');
  const channelId = searchParams.get('channel_id');

  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [patient, setPatient] = useState<{ id: string; patient_name: string; uhid: string | null } | null>(null);
  // 24 Apr 2026 — current user name for counsellor_name auto-fill on Marketing Handoff.
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string>('');
  const [createdFormId, setCreatedFormId] = useState<string>('');

  // Load schema
  useEffect(() => {
    if (formType && FORM_REGISTRY[formType]) {
      setSchema(FORM_REGISTRY[formType]);
    }
  }, [formType]);

  // Load patient (if required)
  useEffect(() => {
    if (!patientId) return;
    fetch(`/api/patients/${patientId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data) {
          setPatient({ id: res.data.id, patient_name: res.data.patient_name, uhid: res.data.uhid });
        }
      })
      .catch(() => {});
  }, [patientId]);

  // 24 Apr 2026 — fetch current user once, used as initialData for the readonly
  // counsellor_name field on Marketing Handoff.
  useEffect(() => {
    fetch('/api/profiles/me')
      .then((r) => r.json())
      .then((res) => {
        const name = res?.data?.full_name || res?.data?.email || '';
        if (name) setCurrentUserName(name);
      })
      .catch(() => {});
  }, []);

  // Submit handler
  const handleSubmit = useCallback(
    async (formData: Record<string, unknown>, completionScore: number) => {
      if (!formType) return;
      setSubmitState('submitting');
      setSubmitError('');

      try {
        const res = await fetch('/api/forms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            form_type: formType,
            form_data: formData,
            patient_thread_id: patientId || undefined,
            getstream_channel_type: channelType || undefined,
            getstream_channel_id: channelId || undefined,
            completion_score: completionScore,
            status: 'submitted',
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to submit form');
        }

        setCreatedFormId(data.data.id);
        setSubmitState('success');
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Something went wrong');
        setSubmitState('error');
      }
    },
    [formType, patientId, channelType, channelId]
  );

  // Save draft handler
  const handleSaveDraft = useCallback(
    async (formData: Record<string, unknown>) => {
      if (!formType) return;

      try {
        const res = await fetch('/api/forms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            form_type: formType,
            form_data: formData,
            patient_thread_id: patientId || undefined,
            status: 'draft',
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          setCreatedFormId(data.data.id);
          alert('Draft saved successfully');
        }
      } catch {
        alert('Failed to save draft');
      }
    },
    [formType, patientId]
  );

  // Error states
  if (!formType || !FORM_REGISTRY[formType]) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg border border-gray-200 p-8 max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900">Invalid Form Type</h2>
          <p className="mt-2 text-sm text-gray-600">
            {formType ? `"${formType}" is not a recognized form type.` : 'No form type specified in URL.'}
          </p>
          <p className="mt-4 text-xs text-gray-500">
            Valid types: {Object.keys(FORM_TYPE_LABELS).join(', ')}
          </p>
          <button
            onClick={() => router.back()}
            className="mt-6 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Success state
  if (submitState === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg border border-gray-200 p-8 max-w-md text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900">Form Submitted</h2>
          <p className="mt-2 text-sm text-gray-600">
            {FORM_TYPE_LABELS[formType]} has been submitted successfully.
          </p>
          {createdFormId && (
            <p className="mt-1 text-xs text-gray-400 font-mono">ID: {createdFormId}</p>
          )}
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              Back to Chat
            </button>
            {createdFormId && (
              <button
                onClick={() => router.push(`/forms/${createdFormId}`)}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
              >
                View Form
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
            title="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 truncate">
              {FORM_TYPE_LABELS[formType]}
            </h1>
            {patient && (
              <p className="text-xs text-gray-500 truncate">
                Patient: {patient.patient_name}
                {patient.uhid && ` (UHID: ${patient.uhid})`}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Form body */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Patient required warning */}
        {schema?.requiresPatient && !patientId && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-800">
              This form is typically linked to a patient thread. You can still submit it without one,
              but it won&apos;t appear in the patient&apos;s timeline.
            </p>
          </div>
        )}

        {/* Error banner */}
        {submitState === 'error' && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-800">Submission Failed</p>
              <p className="text-sm text-red-700 mt-1">{submitError}</p>
            </div>
          </div>
        )}

        {schema && (
          <FormRenderer
            schema={schema}
            initialData={currentUserName ? { counsellor_name: currentUserName } : undefined}
            onSubmit={handleSubmit}
            onSaveDraft={handleSaveDraft}
            isSubmitting={submitState === 'submitting'}
            patientId={patientId || undefined}
          />
        )}
      </main>
    </div>
  );
}
