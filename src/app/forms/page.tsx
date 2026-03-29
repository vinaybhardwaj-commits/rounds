'use client';

// ============================================
// /forms — Form type picker + recent submissions
// Lists available form types grouped by patient
// journey stage. Also shows recent submissions.
// ============================================

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Clock, ChevronRight, ArrowLeft } from 'lucide-react';
import {
  FORM_REGISTRY,
  FORM_TYPE_LABELS,
  FORMS_BY_STAGE,
} from '@/lib/form-registry';
import { PATIENT_STAGE_LABELS, PATIENT_STAGE_COLORS, type FormType } from '@/types';

interface RecentForm {
  id: string;
  form_type: FormType;
  status: string;
  submitted_by_name: string;
  created_at: string;
}

export default function FormsPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Loading...</p></div>}>
      <FormsPage />
    </Suspense>
  );
}

function FormsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const patientId = searchParams.get('patient_id');

  const [recentForms, setRecentForms] = useState<RecentForm[]>([]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('limit', '10');
    if (patientId) params.set('patient_thread_id', patientId);

    fetch(`/api/forms?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setRecentForms(res.data);
      })
      .catch(() => {});
  }, [patientId]);

  const stageOrder = ['opd', 'pre_admission', 'admitted', 'pre_op', 'surgery', 'post_op', 'discharge', 'post_discharge', 'any'];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push('/')}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-semibold text-gray-900">Forms</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Form types by stage */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Submit a New Form
          </h2>

          {stageOrder.map((stage) => {
            const formTypes = FORMS_BY_STAGE[stage];
            if (!formTypes || formTypes.length === 0) return null;

            const stageLabel = stage === 'any'
              ? 'General (Any Stage)'
              : (PATIENT_STAGE_LABELS as Record<string, string>)[stage] || stage;
            const stageColor = stage === 'any'
              ? '#6B7280'
              : (PATIENT_STAGE_COLORS as Record<string, string>)[stage] || '#6B7280';

            return (
              <div key={stage} className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: stageColor }}
                  />
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {stageLabel}
                  </span>
                </div>

                <div className="space-y-1">
                  {formTypes.map((ft) => {
                    const schema = FORM_REGISTRY[ft];
                    const url = patientId
                      ? `/forms/new?type=${ft}&patient_id=${patientId}`
                      : `/forms/new?type=${ft}`;

                    return (
                      <button
                        key={ft}
                        onClick={() => router.push(url)}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors text-left"
                      >
                        <FileText className="h-5 w-5 text-blue-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {FORM_TYPE_LABELS[ft]}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {schema.description}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        {/* Recent submissions */}
        {recentForms.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Recent Submissions
            </h2>
            <div className="space-y-1">
              {recentForms.map((form) => (
                <button
                  key={form.id}
                  onClick={() => router.push(`/forms/${form.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-left"
                >
                  <Clock className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {FORM_TYPE_LABELS[form.form_type]}
                    </p>
                    <p className="text-xs text-gray-500">
                      {form.submitted_by_name} &middot;{' '}
                      {new Date(form.created_at).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    form.status === 'submitted' ? 'bg-blue-100 text-blue-700' :
                    form.status === 'draft' ? 'bg-gray-100 text-gray-600' :
                    form.status === 'reviewed' ? 'bg-green-100 text-green-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {form.status}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
