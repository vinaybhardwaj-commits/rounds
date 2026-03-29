'use client';

// ============================================
// PredictionCard — AI predictions for a patient.
// Shows LOS estimate, discharge readiness, escalation risk.
// Step 8.3: Predictive Intelligence
// ============================================

import { useState } from 'react';
import { Brain, Clock, Activity, AlertTriangle, Loader2 } from 'lucide-react';

interface Predictions {
  estimated_los_days: number | null;
  discharge_readiness_pct: number;
  escalation_risk: 'high' | 'medium' | 'low';
  risk_factors: string[];
}

interface PredictionCardProps {
  patientThreadId: string;
}

const RISK_COLORS = {
  high: { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500' },
  medium: { bg: 'bg-orange-50', text: 'text-orange-600', dot: 'bg-orange-400' },
  low: { bg: 'bg-green-50', text: 'text-green-600', dot: 'bg-green-500' },
};

export function PredictionCard({ patientThreadId }: PredictionCardProps) {
  const [predictions, setPredictions] = useState<Predictions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePredict = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_thread_id: patientThreadId }),
      });
      const data = await res.json();
      if (data.success) {
        setPredictions(data.data.predictions);
      } else {
        setError(data.error || 'Prediction failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
        <Brain size={16} className="text-purple-500" />
        <span className="text-xs font-semibold text-even-navy flex-1">AI Predictions</span>
        {!predictions && (
          <button
            onClick={handlePredict}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[11px] font-medium hover:bg-purple-100 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                Predicting...
              </>
            ) : (
              'Predict'
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-600 text-xs">{error}</div>
      )}

      {predictions && (
        <div className="px-4 py-3 space-y-3">
          {/* LOS estimate */}
          {predictions.estimated_los_days !== null && (
            <div className="flex items-center gap-3">
              <Clock size={14} className="text-blue-400" />
              <span className="text-xs text-gray-500 flex-1">Est. Length of Stay</span>
              <span className="text-sm font-bold text-even-navy">
                {predictions.estimated_los_days} days
              </span>
            </div>
          )}

          {/* Discharge readiness */}
          <div className="flex items-center gap-3">
            <Activity size={14} className="text-green-400" />
            <span className="text-xs text-gray-500 flex-1">Discharge Readiness</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${predictions.discharge_readiness_pct}%`,
                    backgroundColor:
                      predictions.discharge_readiness_pct >= 80
                        ? '#22C55E'
                        : predictions.discharge_readiness_pct >= 50
                        ? '#F97316'
                        : '#EF4444',
                  }}
                />
              </div>
              <span className="text-xs font-bold text-even-navy">
                {predictions.discharge_readiness_pct}%
              </span>
            </div>
          </div>

          {/* Escalation risk */}
          <div className="flex items-center gap-3">
            <AlertTriangle size={14} className="text-orange-400" />
            <span className="text-xs text-gray-500 flex-1">Escalation Risk</span>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${RISK_COLORS[predictions.escalation_risk].bg} ${RISK_COLORS[predictions.escalation_risk].text}`}
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${RISK_COLORS[predictions.escalation_risk].dot}`}
              />
              {predictions.escalation_risk.toUpperCase()}
            </span>
          </div>

          {/* Risk factors */}
          {predictions.risk_factors.length > 0 && (
            <div className="pt-2 border-t border-gray-50">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Risk Factors</p>
              <div className="space-y-1">
                {predictions.risk_factors.map((factor, i) => (
                  <p key={i} className="text-xs text-gray-600">• {factor}</p>
                ))}
              </div>
            </div>
          )}

          {/* Re-predict */}
          <button
            onClick={handlePredict}
            disabled={loading}
            className="text-[11px] text-purple-500 hover:text-purple-700 disabled:opacity-50"
          >
            {loading ? 'Re-predicting...' : 'Refresh prediction'}
          </button>
        </div>
      )}
    </div>
  );
}
