'use client';

import { useState, useEffect } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  ChevronDown,
  Clock,
  Database,
  Play,
  Search,
  Table2,
  AlertTriangle,
  History,
} from 'lucide-react';

// Types
interface ColumnInfo {
  name: string;
  type: string;
  max_length: number | null;
  nullable: boolean;
  default_value: string | null;
}

interface IndexInfo {
  name: string;
  definition: string;
}

interface TableInfo {
  name: string;
  estimated_rows: number;
  total_size: string;
  total_bytes: number;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

interface QueryResult {
  columns: string[];
  rows: any[];
  row_count: number;
  execution_ms: number;
}

interface RecentQuery {
  query: string;
  row_count: number;
  execution_ms: number;
  created_at: string;
  run_by: string;
}

// Helpers
function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function getTypeColor(type: string): string {
  if (type.includes('uuid')) return 'text-purple-600';
  if (type.includes('int') || type.includes('numeric')) return 'text-blue-600';
  if (type.includes('character') || type.includes('text')) return 'text-green-600';
  if (type.includes('timestamp') || type.includes('date')) return 'text-amber-600';
  if (type.includes('boolean')) return 'text-pink-600';
  if (type.includes('json')) return 'text-orange-600';
  return 'text-gray-600';
}

// Schema Browser Component
function SchemaBrowser({
  tables,
  onSelectTable,
  selectedTable,
}: {
  tables: TableInfo[];
  onSelectTable: (name: string) => void;
  selectedTable: string | null;
}) {
  const [search, setSearch] = useState('');
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  const filtered = tables.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalRows = tables.reduce((sum, t) => sum + t.estimated_rows, 0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-600 mb-1">Tables</div>
            <div className="text-lg font-bold text-even-navy">{tables.length}</div>
          </div>
          <div>
            <div className="text-xs text-gray-600 mb-1">Total Rows (est.)</div>
            <div className="text-lg font-bold text-even-blue">{formatNumber(totalRows)}</div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
        <input
          type="text"
          placeholder="Filter tables..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-even-blue"
        />
      </div>

      {/* Table list */}
      <div className="space-y-2">
        {filtered.map(table => {
          const isExpanded = expandedTable === table.name;
          return (
            <div key={table.name} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <button
                onClick={() => setExpandedTable(isExpanded ? null : table.name)}
                className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors ${
                  selectedTable === table.name ? 'bg-even-blue/5' : ''
                }`}
              >
                <ChevronDown
                  size={14}
                  className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                />
                <Table2 size={14} className="text-even-blue" />
                <div className="flex-1 text-left">
                  <span className="text-xs font-semibold text-even-navy">{table.name}</span>
                </div>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span>{formatNumber(table.estimated_rows)} rows</span>
                  <span>{table.total_size}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-3">
                  {/* Quick query button */}
                  <button
                    onClick={() => onSelectTable(table.name)}
                    className="px-3 py-1.5 bg-even-blue text-white text-xs font-medium rounded-lg hover:bg-even-blue/90 transition-colors flex items-center gap-1.5"
                  >
                    <Play size={12} /> SELECT * FROM {table.name} LIMIT 20
                  </button>

                  {/* Columns */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-2">
                      Columns ({table.columns.length})
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left px-2 py-1 text-gray-500 font-medium">Name</th>
                            <th className="text-left px-2 py-1 text-gray-500 font-medium">Type</th>
                            <th className="text-center px-2 py-1 text-gray-500 font-medium">Nullable</th>
                            <th className="text-left px-2 py-1 text-gray-500 font-medium">Default</th>
                          </tr>
                        </thead>
                        <tbody>
                          {table.columns.map((col, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="px-2 py-1 font-mono font-medium text-gray-700">{col.name}</td>
                              <td className={`px-2 py-1 font-mono ${getTypeColor(col.type)}`}>
                                {col.type}{col.max_length ? `(${col.max_length})` : ''}
                              </td>
                              <td className="text-center px-2 py-1 text-gray-500">{col.nullable ? 'Yes' : 'No'}</td>
                              <td className="px-2 py-1 text-gray-500 font-mono truncate max-w-[200px]">
                                {col.default_value || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Indexes */}
                  {table.indexes.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">
                        Indexes ({table.indexes.length})
                      </h4>
                      <div className="space-y-1">
                        {table.indexes.map((idx, i) => (
                          <div key={i} className="text-xs font-mono text-gray-600 bg-white rounded p-2 border border-gray-200 truncate">
                            {idx.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Query Runner Component
function QueryRunner({
  initialQuery,
}: {
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);

  const runQuery = async () => {
    if (!query.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/admin/database/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        setResult(data.data);
      } else {
        setError(data.error || 'Query failed');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setRunning(false);
    }
  };

  // Run on Ctrl+Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  };

  return (
    <div className="space-y-4">
      {/* Editor */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-700">SQL Query</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Ctrl+Enter to run</span>
            <button
              onClick={runQuery}
              disabled={running || !query.trim()}
              className="px-3 py-1.5 bg-even-blue text-white text-xs font-medium rounded-lg hover:bg-even-blue/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <Play size={12} />
              {running ? 'Running...' : 'Run'}
            </button>
          </div>
        </div>
        <textarea
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="SELECT * FROM profiles LIMIT 20"
          rows={5}
          className="w-full px-4 py-3 text-xs font-mono focus:outline-none resize-none"
          spellCheck={false}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-red-700">{error}</div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
            <span className="text-xs text-gray-600">
              {result.row_count} row{result.row_count !== 1 ? 's' : ''} returned
            </span>
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Clock size={12} /> {result.execution_ms}ms
            </span>
          </div>

          {result.rows.length > 0 ? (
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b border-gray-200">
                    {result.columns.map(col => (
                      <th key={col} className="text-left px-3 py-2 text-gray-600 font-medium whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      {result.columns.map(col => (
                        <td key={col} className="px-3 py-2 text-gray-700 font-mono whitespace-nowrap max-w-[300px] truncate">
                          {row[col] === null ? (
                            <span className="text-gray-400 italic">null</span>
                          ) : typeof row[col] === 'object' ? (
                            JSON.stringify(row[col]).substring(0, 100)
                          ) : (
                            String(row[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-gray-500">Query returned no rows</div>
          )}
        </div>
      )}
    </div>
  );
}

// Main Page
export default function DatabaseExplorerPage() {
  const [userRole, setUserRole] = useState('admin');
  const [badges, setBadges] = useState({ approvals: 0, admissions: 0, escalations: 0 });
  const [healthData, setHealthData] = useState<any>(null);

  const [tables, setTables] = useState<TableInfo[]>([]);
  const [recentQueries, setRecentQueries] = useState<RecentQuery[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'schema' | 'query' | 'history'>('schema');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [currentQuery, setCurrentQuery] = useState('');

  // Fetch metadata
  useEffect(() => {
    fetch('/api/profiles/me').then(r => r.json()).then(d => {
      if (d.success && d.data?.role) setUserRole(d.data.role);
    }).catch(() => {});

    Promise.all([
      fetch('/api/admin/approvals').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/escalation/log?resolved=false').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/admission-tracker').then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([approvals, escalations, admissions]) => {
      setBadges({
        approvals: approvals.data?.length || 0,
        escalations: escalations.data?.length || 0,
        admissions: admissions.data?.length || 0,
      });
    });

    fetch('/api/admin/health').then(r => r.json()).then(d => {
      setHealthData({
        llm: { status: d.status || 'down', latency_ms: d.latency_ms || 0 },
        errors_1h: 0, error_sparkline: [], active_sessions: 0,
        api_p95_ms: 0, api_trend: 'stable' as const,
        forms_today: 0, forms_yesterday: 0, last_deploy: { time: '', sha: '' },
      });
    }).catch(() => {});
  }, []);

  // Fetch schema
  useEffect(() => {
    setLoading(true);
    fetch('/api/admin/database/schema')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setTables(d.data.tables);
          setRecentQueries(d.data.recent_queries);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSelectTable = (tableName: string) => {
    setSelectedTable(tableName);
    setCurrentQuery(`SELECT * FROM ${tableName} LIMIT 20`);
    setActiveTab('query');
  };

  return (
    <AdminShell activeSection="database" userRole={userRole} badges={badges} health={healthData}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-even-navy">Database Explorer</h1>
          <p className="text-sm text-gray-600 mt-1">Browse schema, run read-only queries, and inspect data</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl border border-gray-100 p-1 flex gap-1">
          <button
            onClick={() => setActiveTab('schema')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'schema' ? 'bg-even-blue text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="flex items-center gap-2"><Database size={16} /> Schema</span>
          </button>
          <button
            onClick={() => setActiveTab('query')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'query' ? 'bg-even-blue text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="flex items-center gap-2"><Play size={16} /> Query Runner</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'history' ? 'bg-even-blue text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="flex items-center gap-2"><History size={16} /> History</span>
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-sm text-gray-500">Loading schema...</div>
        ) : (
          <>
            {/* Schema Tab */}
            {activeTab === 'schema' && (
              <SchemaBrowser
                tables={tables}
                onSelectTable={handleSelectTable}
                selectedTable={selectedTable}
              />
            )}

            {/* Query Tab */}
            {activeTab === 'query' && (
              <QueryRunner initialQuery={currentQuery} />
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-700">Query Audit Log (last 20)</h3>
                </div>
                {recentQueries.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {recentQueries.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          if (!q.query.startsWith('[REJECTED]')) {
                            setCurrentQuery(q.query);
                            setActiveTab('query');
                          }
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <pre className="text-xs font-mono text-gray-700 truncate flex-1 max-w-[500px]">
                            {q.query}
                          </pre>
                          <div className="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
                            {q.row_count >= 0 ? (
                              <span className="text-green-600">{q.row_count} rows</span>
                            ) : (
                              <span className="text-red-600">Rejected</span>
                            )}
                            <span>{q.execution_ms}ms</span>
                            <span className="whitespace-nowrap">{formatTime(q.created_at)}</span>
                          </div>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">by {q.run_by || 'Unknown'}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-gray-500">No queries logged yet</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}
