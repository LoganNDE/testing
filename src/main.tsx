import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';
import { motion, type Transition } from 'framer-motion';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  ChevronDown,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileJson,
  ListChecks,
  Loader2,
  Mic,
  Pause,
  Play,
  Search,
  Sparkles,
  Square,
  XCircle,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { defaultPoints } from './data/defaultStandard';
import ifsHpcStandard from './data/ifs_hpc_parte_2_requisitos_completo.json';
import { emptyEntry, statusLabels, summarize } from './lib/audit';
import { exportAuditWorkbook } from './lib/exportExcel';
import { parseStandardJson } from './lib/standardParser';
import type { AuditEntry, AuditMetadata, AuditStatus, StandardPoint } from './types';
import './styles.css';

type WorkflowStep = 'company' | 'scope' | 'mode' | 'voice' | 'audit';
type AppView = 'audit' | 'scope' | 'data' | 'stats';
type AuditMode = 'manual' | 'voice';

interface VoiceAuditResult {
  point: StandardPoint;
  patch: Partial<AuditEntry>;
  excerpt: string;
  confidence?: number;
}

const STORAGE_KEY = 'ifs-hpc-audit-state-v5';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';
const bundledPoints = parseStandardJson(ifsHpcStandard);

const statusColors: Record<AuditStatus, string> = {
  pending: '#64748b',
  pass: '#15803d',
  fail: '#b91c1c',
  omit: '#a16207',
  not_applicable: '#0369a1',
};

const smoothEase: [number, number, number, number] = [0.23, 1, 0.32, 1];
const auditActionStatuses: AuditStatus[] = ['pass', 'fail', 'not_applicable'];
const SpeechRecognitionCtor =
  typeof window !== 'undefined' ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : null;
const preferredAudioMimeTypes = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];
const voiceProcessingMessages = [
  'Preparando audio y transcripcion',
  'Transcribiendo la grabacion',
  'Identificando puntos IFS HPC',
  'Rellenando estados, detalles y comentarios',
];

const softEnter = {
  initial: { opacity: 0, transform: 'translateY(14px)' },
  animate: { opacity: 1, transform: 'translateY(0)' },
  transition: { duration: 0.2, ease: smoothEase } satisfies Transition,
};

function pointRequirement(point: StandardPoint): string {
  return point.requirement || point.description;
}

function pointHeading(point: StandardPoint): string {
  return point.title && point.title !== point.code ? `${point.code} · ${point.title}` : point.code;
}

function supportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return preferredAudioMimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function audioFileExtension(mimeType: string): string {
  const type = mimeType.split(';')[0].trim().toLowerCase();
  if (type === 'audio/mp4' || type === 'audio/x-m4a') return 'm4a';
  if (type === 'audio/mpeg' || type === 'audio/mp3') return 'mp3';
  if (type === 'audio/ogg') return 'ogg';
  if (type === 'audio/wav' || type === 'audio/wave') return 'wav';
  return 'webm';
}

async function readApiError(response: Response): Promise<string> {
  const fallback = 'No se pudo procesar la auditoria de voz.';
  const contentType = response.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return data?.error || fallback;
    }
    const text = await response.text();
    return text || fallback;
  } catch {
    return fallback;
  }
}

function voiceResultStatus(result: VoiceAuditResult): AuditStatus {
  return result.patch.status ?? 'pass';
}

function compactPointLabel(point: StandardPoint): string {
  const text = pointRequirement(point).replace(/\s+/g, ' ').trim();
  return `${point.code} · ${text}`;
}

function normalizeSpeechText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractField(segment: string, label: string): string {
  const fieldPattern = new RegExp(`${label}\\s*[:,-]?\\s*([\\s\\S]*?)(?=\\b(?:comentario|datos adicionales|datos|evidencias|evidencia|accion correctiva|accion|responsable|fecha limite|punto|requisito)\\b|$)`, 'i');
  return segment.match(fieldPattern)?.[1]?.trim() ?? '';
}

function parseVoiceAuditTranscript(transcript: string, points: StandardPoint[]): VoiceAuditResult[] {
  const normalizedTranscript = normalizeSpeechText(transcript);
  if (!normalizedTranscript) return [];

  const codeMatches = Array.from(normalizedTranscript.matchAll(/\b\d+(?:\.\d+){0,5}\*?\b/g));
  if (!codeMatches.length) return [];

  const pointByCode = new Map(points.map((point) => [point.code.replace(/\*$/, ''), point]));

  return codeMatches.flatMap((match, index) => {
    const code = match[0].replace(/\*$/, '');
    const point = pointByCode.get(code);
    if (!point) return [];

    const nextMatch = codeMatches[index + 1];
    const segment = normalizedTranscript.slice(match.index, nextMatch?.index ?? normalizedTranscript.length).trim();
    const patch: Partial<AuditEntry> = {};

    if (/\bno\s+conforme\b|\bno\s+cumple\b|\bno\s+pasa\b/.test(segment)) patch.status = 'fail';
    else if (/\bno\s+aplica\b|\bno\s+aplicable\b/.test(segment)) patch.status = 'not_applicable';
    else if (/\bconforme\b|\bcumple\b|\bpasa\b|\bapto\b/.test(segment)) patch.status = 'pass';

    const comment = extractField(segment, 'comentario');
    const extraData = extractField(segment, 'datos adicionales|datos');
    const evidence = extractField(segment, 'evidencias|evidencia');
    const correctiveAction = extractField(segment, 'accion correctiva|accion');
    const responsible = extractField(segment, 'responsable');
    const dueDate = extractField(segment, 'fecha limite');

    if (comment) patch.comment = comment;
    if (extraData) patch.extraData = extraData;
    if (evidence) patch.evidence = evidence;
    if (correctiveAction) patch.correctiveAction = correctiveAction;
    if (responsible) patch.responsible = responsible;
    if (dueDate) patch.dueDate = dueDate;
    if (!comment && !extraData && !evidence && !correctiveAction) patch.comment = segment.replace(new RegExp(`^${code.replace(/\./g, '\\.')}\\s*`), '').trim();

    return [{ point, patch, excerpt: segment }];
  });
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function initialMetadata(): AuditMetadata {
  return {
    company: '',
    site: '',
    auditor: '',
    auditDate: new Date().toISOString().slice(0, 10),
    standardName: 'IFS-HPC',
  };
}

function App() {
  const stored = loadState();
  const [points, setPoints] = React.useState<StandardPoint[]>(stored?.points ?? (bundledPoints.length ? bundledPoints : defaultPoints));
  const [entries, setEntries] = React.useState<Record<string, AuditEntry>>(stored?.entries ?? {});
  const [selectedIds, setSelectedIds] = React.useState<string[]>(stored?.selectedIds ?? points.map((point) => point.id));
  const [selectedId, setSelectedId] = React.useState<string>(stored?.selectedId ?? selectedIds[0] ?? points[0]?.id);
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<AuditStatus | 'all'>('all');
  const [workflowStep, setWorkflowStep] = React.useState<WorkflowStep>(stored?.workflowStep ?? 'company');
  const [activeView, setActiveView] = React.useState<AppView>('audit');
  const [metadata, setMetadata] = React.useState<AuditMetadata>(stored?.metadata ?? initialMetadata());
  const [auditMode, setAuditMode] = React.useState<AuditMode>(stored?.auditMode ?? 'manual');
  const [voiceDraftResults, setVoiceDraftResults] = React.useState<VoiceAuditResult[]>(stored?.voiceDraftResults ?? []);

  const auditPoints = React.useMemo(() => {
    const selected = new Set(selectedIds);
    return points.filter((point) => selected.has(point.id));
  }, [points, selectedIds]);

  const selected = auditPoints.find((point) => point.id === selectedId) ?? auditPoints[0];
  const selectedEntry = selected ? entries[selected.id] ?? emptyEntry() : emptyEntry();
  const summary = summarize(auditPoints, entries);
  const selectedIndex = selected ? auditPoints.findIndex((point) => point.id === selected.id) : -1;

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ points, entries, selectedIds, selectedId, metadata, workflowStep, auditMode, voiceDraftResults }));
  }, [points, entries, selectedIds, selectedId, metadata, workflowStep, auditMode, voiceDraftResults]);

  React.useEffect(() => {
    if (!auditPoints.length) return;
    if (!auditPoints.some((point) => point.id === selectedId)) setSelectedId(auditPoints[0].id);
  }, [auditPoints, selectedId]);

  const filteredPoints = auditPoints.filter((point) => {
    const entry = entries[point.id];
    const text = `${point.code} ${point.title} ${pointRequirement(point)} ${point.sectionPath.join(' ')}`.toLowerCase();
    const matchesQuery = text.includes(query.toLowerCase());
    const matchesStatus = statusFilter === 'all' || (entry?.status ?? 'pending') === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const chartData = [
    { name: statusLabels.pass, value: summary.passed, color: statusColors.pass },
    { name: statusLabels.fail, value: summary.failed, color: statusColors.fail },
    { name: 'Omitido', value: summary.omitted, color: statusColors.omit },
    { name: 'No aplica', value: summary.notApplicable, color: statusColors.not_applicable },
    { name: 'Pendiente', value: summary.pending, color: statusColors.pending },
  ].filter((item) => item.value > 0);

  function updateEntry(pointId: string, patch: Partial<AuditEntry>) {
    setEntries((current) => ({
      ...current,
      [pointId]: { ...(current[pointId] ?? emptyEntry()), ...patch, updatedAt: new Date().toISOString() },
    }));
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const parsed = parseStandardJson(json);
      if (!parsed.length) throw new Error('No se encontraron puntos auditables en el JSON.');
      setPoints(parsed);
      setSelectedIds(parsed.map((point) => point.id));
      setEntries({});
      setSelectedId(parsed[0].id);
      toast.success(`Norma importada: ${parsed.length} puntos detectados`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo importar el JSON.');
    }
  }

  function handleCompanyNext(event: React.FormEvent) {
    event.preventDefault();
    if (!metadata.company.trim() || !metadata.auditor.trim() || !metadata.auditDate) {
      toast.error('Completa empresa, auditor y fecha para continuar.');
      return;
    }
    setWorkflowStep('scope');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startAudit() {
    if (!selectedIds.length) {
      toast.error('Selecciona al menos un punto para auditar.');
      return;
    }
    setSelectedId((current) => (selectedIds.includes(current) ? current : selectedIds[0]));
    setAuditMode('manual');
    setWorkflowStep('audit');
    setActiveView('audit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function continueToMode() {
    if (!selectedIds.length) {
      toast.error('Selecciona al menos un punto para auditar.');
      return;
    }
    setWorkflowStep('mode');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function selectAuditMode(mode: AuditMode) {
    if (mode === 'manual') {
      startAudit();
      return;
    }
    setAuditMode('voice');
    setWorkflowStep('voice');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function switchToManualAudit() {
    setAuditMode('manual');
    setWorkflowStep('audit');
    setActiveView('audit');
    setSelectedId((current) => (selectedIds.includes(current) ? current : selectedIds[0]));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function switchToVoiceAudit() {
    if (!selectedIds.length) {
      toast.error('Selecciona al menos un punto para auditar.');
      return;
    }
    setAuditMode('voice');
    setWorkflowStep('voice');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function applyVoiceResults(results: VoiceAuditResult[]) {
    if (!results.length) {
      toast.error('No se detectaron puntos auditables en la transcripcion.');
      return;
    }

    setEntries((current) => {
      const next = { ...current };
      results.forEach((result) => {
        next[result.point.id] = {
          ...(next[result.point.id] ?? emptyEntry()),
          ...result.patch,
          status: result.patch.status ?? 'pass',
          updatedAt: new Date().toISOString(),
        };
      });
      return next;
    });
    setSelectedId(results[0].point.id);
    setVoiceDraftResults(results);
    setAuditMode('manual');
    setWorkflowStep('audit');
    setActiveView('audit');
    toast.success(`${results.length} puntos actualizados desde la auditoria de voz`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleExport() {
    if (!metadata.company.trim()) {
      toast.error('Indica la empresa antes de exportar.');
      setActiveView('data');
      return;
    }
    exportAuditWorkbook(auditPoints, entries, metadata);
  }

  function goToPoint(offset: number) {
    if (selectedIndex < 0) return;
    const nextIndex = Math.min(Math.max(selectedIndex + offset, 0), auditPoints.length - 1);
    setSelectedId(auditPoints[nextIndex].id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function togglePoint(pointId: string) {
    setSelectedIds((current) => (current.includes(pointId) ? current.filter((id) => id !== pointId) : [...current, pointId]));
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>
      <main className="app-shell" id="main-content" tabIndex={-1}>
      <Toaster richColors position="top-right" />

      {workflowStep === 'company' && (
        <SetupStep metadata={metadata} setMetadata={setMetadata} onSubmit={handleCompanyNext} />
      )}

      {workflowStep === 'scope' && (
        <ScopeStep
          points={points}
          selectedIds={selectedIds}
          onToggle={togglePoint}
          onSelectAll={() => setSelectedIds(points.map((point) => point.id))}
          onClear={() => setSelectedIds([])}
          onSelectMany={(ids) => setSelectedIds((current) => Array.from(new Set([...current, ...ids])))}
          onClearMany={(ids) => setSelectedIds((current) => current.filter((id) => !ids.includes(id)))}
          onBack={() => setWorkflowStep('company')}
          onStart={continueToMode}
          onImport={handleImport}
        />
      )}

      {workflowStep === 'mode' && (
        <AuditModeStep onBack={() => setWorkflowStep('scope')} onSelectMode={selectAuditMode} />
      )}

      {workflowStep === 'voice' && (
        <VoiceAuditStep
          points={auditPoints}
          summary={summary}
          initialResults={voiceDraftResults}
          onBack={() => setWorkflowStep('mode')}
          onApply={applyVoiceResults}
          onDraftResultsChange={setVoiceDraftResults}
          onManualMode={switchToManualAudit}
          onVoiceMode={switchToVoiceAudit}
          onEditScope={() => {
            setWorkflowStep('audit');
            setActiveView('scope');
          }}
          onEditData={() => {
            setWorkflowStep('audit');
            setActiveView('data');
          }}
        />
      )}

      {workflowStep === 'audit' && (
        <>
          <AuditHeader
            metadata={metadata}
            auditMode={auditMode}
            onEditData={() => setActiveView('data')}
            onEditScope={() => setActiveView('scope')}
            onManualMode={switchToManualAudit}
            onVoiceMode={switchToVoiceAudit}
          />

          <AuditProgressBar progress={summary.progress} />

          {activeView === 'audit' && selected && (
            <section className="workspace">
              <aside className="sidebar">
                <div className="filter-row">
                  <div className="search-box">
                    <Search size={16} aria-hidden="true" />
                    <input name="audit-point-search" autoComplete="off" placeholder="Buscar punto…" value={query} onChange={(event) => setQuery(event.target.value)} />
                  </div>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AuditStatus | 'all')}>
                    <option value="all">Todos</option>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <nav className="point-list">
                  {filteredPoints.map((point) => {
                    const status = entries[point.id]?.status ?? 'pending';
                    return (
                      <button
                        key={point.id}
                        className={`status-${status} ${point.id === selected.id ? 'active' : ''}`}
                        title={compactPointLabel(point)}
                        onClick={() => setSelectedId(point.id)}
                      >
                        <span className="point-code">{point.code}</span>
                        <span className="point-title">{pointRequirement(point)}</span>
                        <span className="point-meta">
                          {point.ko ? `KO ${point.ko}` : point.mandatory ? 'Obligatorio' : 'Opcional'} · {statusLabels[status]}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </aside>

              <AuditPointPanel
                point={selected}
                entry={selectedEntry}
                index={selectedIndex}
                total={auditPoints.length}
                points={auditPoints}
                onPrev={() => goToPoint(-1)}
                onNext={() => goToPoint(1)}
                onSelectPoint={setSelectedId}
                onUpdate={(patch) => updateEntry(selected.id, patch)}
              />
            </section>
          )}

          {activeView === 'data' && (
            <section className="single-panel">
              <details className="data-details" open>
                <summary>Datos de empresa y auditoria</summary>
                <MetadataForm metadata={metadata} setMetadata={setMetadata} />
                <button className="primary-action" onClick={() => setActiveView('audit')}>
                  Volver a auditar
                </button>
              </details>
            </section>
          )}

          {activeView === 'scope' && (
            <ScopeStep
              points={points}
              selectedIds={selectedIds}
              onToggle={togglePoint}
              onSelectAll={() => setSelectedIds(points.map((point) => point.id))}
              onClear={() => setSelectedIds([])}
              onSelectMany={(ids) => setSelectedIds((current) => Array.from(new Set([...current, ...ids])))}
              onClearMany={(ids) => setSelectedIds((current) => current.filter((id) => !ids.includes(id)))}
              onBack={() => setActiveView('audit')}
              onStart={startAudit}
              onImport={handleImport}
              title="Modificar Alcance"
              description="Ajusta los puntos de auditoría sin perder comentarios, evidencias ni estados ya guardados."
              backLabel="Volver a auditoria"
              startLabel="Guardar alcance"
              compactFooter
            />
          )}

          {activeView === 'stats' && (
            <StatsView summary={summary} chartData={chartData} />
          )}

          <BottomNav activeView={activeView} setActiveView={setActiveView} onExport={handleExport} />
        </>
      )}
      </main>
    </>
  );
}

function SetupStep({
  metadata,
  setMetadata,
  onSubmit,
}: {
  metadata: AuditMetadata;
  setMetadata: React.Dispatch<React.SetStateAction<AuditMetadata>>;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <motion.section className="step-screen" {...softEnter}>
      <StepProgress current={1} />
      <div className="step-hero app-intro">
        <h1>Prepara la Auditoria</h1>
        <p className="step-copy">Configura los datos base y define el alcance antes de entrar punto por punto.</p>
      </div>
      <form className="step-card elevated-card" onSubmit={onSubmit}>
        <div className="card-heading">
          <h2>Datos iniciales</h2>
          <p>Esta información aparecerá en el Excel final.</p>
        </div>
        <MetadataForm metadata={metadata} setMetadata={setMetadata} />
        <button className="primary-action" type="submit">
          Continuar al Alcance
        </button>
      </form>
    </motion.section>
  );
}

function ScopeStep({
  points,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
  onSelectMany,
  onClearMany,
  onBack,
  onStart,
  onImport,
  title = 'Selecciona el Alcance',
  description = 'Despliega cada bloque y marca solo los puntos que vas a auditar.',
  backLabel = 'Volver',
  startLabel = 'Comenzar Auditoria',
  compactFooter = false,
}: {
  points: StandardPoint[];
  selectedIds: string[];
  onToggle: (pointId: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onSelectMany: (ids: string[]) => void;
  onClearMany: (ids: string[]) => void;
  onBack: () => void;
  onStart: () => void;
  onImport: (file: File) => void;
  title?: string;
  description?: string;
  backLabel?: string;
  startLabel?: string;
  compactFooter?: boolean;
}) {
  const [scopeQuery, setScopeQuery] = React.useState('');
  const filtered = points.filter((point) => {
    const text = `${point.code} ${point.title} ${pointRequirement(point)} ${point.sectionPath.join(' ')}`.toLowerCase();
    return text.includes(scopeQuery.toLowerCase());
  });
  const selectedSet = new Set(selectedIds);
  const groups = groupScopePoints(filtered, selectedSet);

  return (
    <motion.section className={`step-screen wide-step ${compactFooter ? 'with-bottom-nav' : ''}`} {...softEnter}>
      <StepProgress current={2} />
      <div className="scope-header">
        <div>
          <h1>{title}</h1>
          <p className="step-copy">{description}</p>
        </div>
        <div className="selection-counter">
          <strong>{selectedIds.length}</strong>
          <span>de {points.length} puntos</span>
        </div>
      </div>

      <div className="scope-toolbar">
        <div className="search-box">
          <Search size={16} aria-hidden="true" />
          <input name="scope-search" autoComplete="off" placeholder="Buscar punto o subpunto…" value={scopeQuery} onChange={(event) => setScopeQuery(event.target.value)} />
        </div>
        <label className="import-button light">
          <FileJson size={18} aria-hidden="true" />
          Importar JSON
          <input name="standard-json" type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && onImport(event.target.files[0])} />
        </label>
      </div>

      <div className="scope-actions">
        <button onClick={onSelectAll}>Seleccionar todos</button>
        <button onClick={onClear}>Deseleccionar todos</button>
        <strong>{groups.length} grupos visibles</strong>
      </div>

      <div className="scope-list">
        {groups.map((group, index) => (
          <ScopeGroup
            key={group.name}
            group={group}
            selectedSet={selectedSet}
            initiallyOpen={Boolean(scopeQuery) || index === 0}
            onToggle={onToggle}
            onSelectMany={onSelectMany}
            onClearMany={onClearMany}
          />
        ))}
      </div>

      <div className="step-footer">
        <button className="secondary-action" onClick={onBack}>
          {backLabel}
        </button>
        <button className="primary-action" onClick={onStart}>
          {startLabel}
        </button>
      </div>
    </motion.section>
  );
}

function AuditModeStep({
  onBack,
  onSelectMode,
}: {
  onBack: () => void;
  onSelectMode: (mode: AuditMode) => void;
}) {
  return (
    <motion.section className="step-screen" {...softEnter}>
      <StepProgress current={3} />
      <div className="step-hero app-intro">
        <h1>Elige el modo de Auditoria</h1>
        <p className="step-copy">Puedes completar la auditoría punto por punto o grabar una sesión para rellenar campos automáticamente desde la voz.</p>
      </div>

      <div className="mode-grid">
        <button className="mode-card" onClick={() => onSelectMode('manual')}>
          <ListChecks size={24} aria-hidden="true" />
          <strong>Auditoria manual</strong>
          <span>Revisa cada requisito y completa los campos directamente.</span>
        </button>
        <button className="mode-card accent" onClick={() => onSelectMode('voice')}>
          <Mic size={24} aria-hidden="true" />
          <strong>Auditoria automatica por voz</strong>
          <span>Graba la locución, revisa la transcripción y aplica los puntos detectados.</span>
        </button>
      </div>

      <div className="step-footer">
        <button className="secondary-action" onClick={onBack}>
          Volver al alcance
        </button>
      </div>
    </motion.section>
  );
}

function VoiceAuditStep({
  points,
  summary,
  initialResults,
  onBack,
  onApply,
  onDraftResultsChange,
  onManualMode,
  onVoiceMode,
  onEditScope,
  onEditData,
}: {
  points: StandardPoint[];
  summary: ReturnType<typeof summarize>;
  initialResults: VoiceAuditResult[];
  onBack: () => void;
  onApply: (results: VoiceAuditResult[]) => void;
  onDraftResultsChange: (results: VoiceAuditResult[]) => void;
  onManualMode: () => void;
  onVoiceMode: () => void;
  onEditScope: () => void;
  onEditData: () => void;
}) {
  const [recordingState, setRecordingState] = React.useState<'idle' | 'recording' | 'paused' | 'finished'>('idle');
  const [transcript, setTranscript] = React.useState('');
  const [audioUrl, setAudioUrl] = React.useState('');
  const [audioBlob, setAudioBlob] = React.useState<Blob | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [processingStep, setProcessingStep] = React.useState(0);
  const [processedResults, setProcessedResults] = React.useState<VoiceAuditResult[]>(initialResults);
  const [audioLevels, setAudioLevels] = React.useState<number[]>(() => Array.from({ length: 18 }, () => 0.08));
  const [heardSpeech, setHeardSpeech] = React.useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const speechRef = React.useRef<any>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analyserFrameRef = React.useRef<number | null>(null);
  const volumeSamplesRef = React.useRef<number[]>([]);

  const detectedResults = React.useMemo(() => parseVoiceAuditTranscript(transcript, points), [points, transcript]);
  const reviewResults = processedResults.length ? processedResults : detectedResults;
  const hasProcessedResults = processedResults.length > 0;
  const canUseSpeechRecognition = Boolean(SpeechRecognitionCtor);

  React.useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      speechRef.current?.stop?.();
      stopAudioMeter();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  React.useEffect(() => {
    if (!isProcessing) return;
    const timer = window.setInterval(() => {
      setProcessingStep((current) => Math.min(current + 1, voiceProcessingMessages.length - 1));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [isProcessing]);

  function stopAudioMeter() {
    if (analyserFrameRef.current) {
      window.cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }

  function startAudioMeter(stream: MediaStream, reset = false) {
    stopAudioMeter();
    const AudioContextCtor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    analyser.fftSize = 512;
    const buffer = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    audioContextRef.current = audioContext;
    if (reset) {
      volumeSamplesRef.current = [];
      setHeardSpeech(false);
      setAudioLevels(Array.from({ length: 18 }, () => 0.08));
    }

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / buffer.length);
      volumeSamplesRef.current.push(rms);
      if (volumeSamplesRef.current.length > 240) volumeSamplesRef.current.shift();
      if (rms > 0.035) setHeardSpeech(true);
      setAudioLevels((current) => [...current.slice(1), Math.min(1, Math.max(0.08, rms * 9))]);
      analyserFrameRef.current = window.requestAnimationFrame(tick);
    };

    tick();
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      setProcessedResults([]);
      onDraftResultsChange([]);
      volumeSamplesRef.current = [];
      startAudioMeter(stream, true);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || chunksRef.current[0]?.type || 'audio/webm' });
        setAudioBlob(audioBlob);
        setAudioUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return URL.createObjectURL(audioBlob);
        });
        stream.getTracks().forEach((track) => track.stop());
        stopAudioMeter();
      };
      recorder.start();
      mediaRecorderRef.current = recorder;

      if (SpeechRecognitionCtor) {
        const recognition = new SpeechRecognitionCtor();
        recognition.lang = 'es-ES';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event: any) => {
          const text = Array.from(event.results)
            .map((result: any) => result[0]?.transcript ?? '')
            .join(' ');
          setTranscript(text);
        };
        recognition.start();
        speechRef.current = recognition;
      }

      setRecordingState('recording');
      toast.success('Grabacion iniciada');
    } catch {
      toast.error('No se pudo acceder al microfono.');
    }
  }

  function pauseRecording() {
    mediaRecorderRef.current?.pause();
    speechRef.current?.stop?.();
    stopAudioMeter();
    setRecordingState('paused');
  }

  function resumeRecording() {
    mediaRecorderRef.current?.resume();
    speechRef.current?.start?.();
    const stream = mediaRecorderRef.current?.stream;
    if (stream) startAudioMeter(stream);
    setRecordingState('recording');
  }

  function finishRecording() {
    mediaRecorderRef.current?.stop();
    speechRef.current?.stop?.();
    stopAudioMeter();
    setRecordingState('finished');
  }

  function resetRecording() {
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    speechRef.current?.stop?.();
    stopAudioMeter();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    chunksRef.current = [];
    volumeSamplesRef.current = [];
    setRecordingState('idle');
    setAudioBlob(null);
    setAudioUrl('');
    setTranscript('');
    setProcessedResults([]);
    setHeardSpeech(false);
    setAudioLevels(Array.from({ length: 18 }, () => 0.08));
    onDraftResultsChange([]);
  }

  async function processWithAi() {
    const hasUsableAudio = !audioBlob || heardSpeech || volumeSamplesRef.current.length < 10;
    if (!transcript.trim() && !hasUsableAudio) {
      toast.error('No se detecto voz en la grabacion. Graba de nuevo o escribe la transcripcion antes de procesar.');
      return;
    }

    setIsProcessing(true);
    setProcessingStep(0);
    setProcessedResults([]);
    onDraftResultsChange([]);
    try {
      const form = new FormData();
      if (audioBlob) form.append('audio', audioBlob, `auditoria-voz.${audioFileExtension(audioBlob.type)}`);
      form.append('transcript', transcript);
      form.append('points', JSON.stringify(points));

      const response = await fetch(`${API_BASE_URL}/api/voice-audit`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const data = await response.json();
      setProcessingStep(voiceProcessingMessages.length - 1);

      if (data.transcript) setTranscript(data.transcript);
      const pointById = new Map(points.map((point) => [point.id, point]));
      const pointByCode = new Map(points.map((point) => [point.code.replace(/\*$/, ''), point]));
      const results: VoiceAuditResult[] = (data.items ?? []).flatMap((item: any) => {
        const point = pointById.get(item.pointId) ?? pointByCode.get(String(item.pointCode || '').replace(/\*$/, ''));
        if (!point) return [];
        const patch: Partial<AuditEntry> = {};
        if (item.status && item.status !== 'pending') patch.status = item.status;
        if (item.comment) patch.comment = item.comment;
        if (item.extraData) patch.extraData = item.extraData;
        if (item.evidence) patch.evidence = item.evidence;
        if (item.correctiveAction) patch.correctiveAction = item.correctiveAction;
        if (item.responsible) patch.responsible = item.responsible;
        if (item.dueDate) patch.dueDate = item.dueDate;
        return [{ point, patch, excerpt: item.sourceText || item.comment || '', confidence: item.confidence }];
      });

      if (data.warnings?.length) toast.message(data.warnings.join(' · '));
      const nextResults = results.length ? results : detectedResults;
      if (!nextResults.length) {
        toast.error('No se detectaron puntos auditables en la transcripcion.');
        return;
      }
      setProcessedResults(nextResults);
      onDraftResultsChange(nextResults);
      toast.success(`${nextResults.length} puntos identificados y listos para revisar`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo procesar con IA.');
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <motion.section className="step-screen wide-step audit-mode-screen" {...softEnter}>
      <div className="scope-header voice-header">
        <div>
          <h1>Auditoria de voz</h1>
          <p className="step-copy">Dicta el punto de la norma, el resultado y los campos que quieras rellenar. Después revisa la transcripción antes de aplicarla.</p>
        </div>
        <div className="voice-top-actions">
          <div className="voice-action-row">
            <div className="audit-mode-switch" aria-label="Cambiar modo de auditoria">
              <button onClick={onManualMode}>
                <ListChecks size={16} aria-hidden="true" />
                Manual
              </button>
              <button className="active" onClick={onVoiceMode}>
                <Mic size={16} aria-hidden="true" />
                Automatica
              </button>
            </div>
            <button className="secondary-action" onClick={onEditScope}>
              <ClipboardCheck size={18} aria-hidden="true" />
              Puntos
            </button>
            <button className="secondary-action" onClick={onEditData}>
              <Building2 size={18} aria-hidden="true" />
              Datos
            </button>
          </div>
          <div className={`recording-indicator ${recordingState}`}>
            <Mic size={18} aria-hidden="true" />
            <span>{recordingState === 'recording' ? 'Grabando' : recordingState === 'paused' ? 'Pausado' : recordingState === 'finished' ? 'Finalizado' : 'Listo'}</span>
          </div>
        </div>
      </div>

      <AuditProgressBar progress={summary.progress} />

      <section className="voice-panel">
        <details className="voice-guide">
          <summary>
            <span>Guia rapida para dictar</span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <dl>
            <div>
              <dt>Estados</dt>
              <dd>conforme, no conforme, no aplica</dd>
            </div>
            <div>
              <dt>Campos</dt>
              <dd>comentario de auditoria, datos adicionales, evidencia, accion correctiva, responsable, fecha limite</dd>
            </div>
            <div>
              <dt>Ejemplo</dt>
              <dd>Punto 1.1.1 conforme. Comentario de auditoria: politica comunicada. Datos adicionales: revisado con direccion.</dd>
            </div>
          </dl>
        </details>

        <div className="voice-controls">
          {recordingState === 'idle' && (
            <button className="record-button" aria-label="Grabar sesion" onClick={startRecording}>
              <Mic size={18} aria-hidden="true" />
            </button>
          )}
          {recordingState === 'recording' && (
            <>
              <button className="secondary-action" onClick={pauseRecording}>
                <Pause size={18} aria-hidden="true" />
                Pausar
              </button>
              <button className="primary-action danger-action" onClick={finishRecording}>
                <Square size={18} aria-hidden="true" />
                Finalizar
              </button>
            </>
          )}
          {recordingState === 'paused' && (
            <>
              <button className="secondary-action" onClick={resumeRecording}>
                <Play size={18} aria-hidden="true" />
                Reanudar
              </button>
              <button className="primary-action danger-action" onClick={finishRecording}>
                <Square size={18} aria-hidden="true" />
                Finalizar
              </button>
            </>
          )}
          {audioUrl ? (
            <div className="voice-player">
              <div>
                <span>Grabacion de voz</span>
                <button className="voice-player-reset" onClick={resetRecording}>
                  Repetir grabacion
                </button>
              </div>
              <audio controls src={audioUrl} />
            </div>
          ) : null}
        </div>

        <div className={`voice-waveform ${recordingState === 'recording' ? 'active' : ''}`} aria-hidden="true">
          {audioLevels.map((level, index) => (
            <span key={index} style={{ transform: `scaleY(${level})` }} />
          ))}
        </div>

        {!canUseSpeechRecognition && (
          <p className="voice-note">Este navegador no ofrece transcripción local automática. Puedes pegar aquí el texto generado por tu transcriptor IA y aplicar el análisis.</p>
        )}

        <label className="voice-transcript">
          <span>Transcripcion de la auditoria</span>
          <textarea
            value={transcript}
            onChange={(event) => {
              setTranscript(event.target.value);
              setProcessedResults([]);
              onDraftResultsChange([]);
            }}
            rows={8}
            placeholder="Ejemplo: Punto 1.1.1 conforme. Comentario politica comunicada. Datos adicionales revisado con direccion. Punto 1.1.2 no conforme. Comentario falta evidencia documental."
          />
        </label>
      </section>

      <section className="voice-results">
        <div className="card-heading">
          <h2>{hasProcessedResults ? 'Puntos identificados y rellenados' : 'Puntos detectados'}</h2>
          <p>
            {isProcessing
              ? voiceProcessingMessages[processingStep]
              : reviewResults.length
                ? `${reviewResults.length} puntos ${hasProcessedResults ? 'revisados por IA y listos para continuar.' : 'detectados en la transcripcion.'}`
                : 'Aun no se han detectado puntos de la auditoria.'}
          </p>
        </div>

        {isProcessing ? (
          <div className="voice-processing" role="status" aria-live="polite">
            <Loader2 size={24} aria-hidden="true" />
            <div>
              <strong>Procesando auditoria de voz</strong>
              <span>{voiceProcessingMessages[processingStep]}</span>
            </div>
          </div>
        ) : null}

        <div className="voice-result-list">
          {reviewResults.map((result, index) => (
            <details key={`${result.point.id}-${result.excerpt}`} className="voice-result-item" open={hasProcessedResults && index === 0}>
              <summary>
                <strong>{result.point.code}</strong>
                <span>{statusLabels[voiceResultStatus(result)]}</span>
                <p>{result.patch.comment || result.excerpt || pointRequirement(result.point)}</p>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <div className="voice-result-details">
                <dl>
                  <div>
                    <dt>Requisito</dt>
                    <dd>{pointRequirement(result.point)}</dd>
                  </div>
                  <div>
                    <dt>Estado</dt>
                    <dd>{statusLabels[voiceResultStatus(result)]}</dd>
                  </div>
                  {result.patch.comment ? (
                    <div>
                      <dt>Comentario</dt>
                      <dd>{result.patch.comment}</dd>
                    </div>
                  ) : null}
                  {result.patch.extraData ? (
                    <div>
                      <dt>Datos adicionales</dt>
                      <dd>{result.patch.extraData}</dd>
                    </div>
                  ) : null}
                  {result.patch.evidence ? (
                    <div>
                      <dt>Evidencia</dt>
                      <dd>{result.patch.evidence}</dd>
                    </div>
                  ) : null}
                  {result.patch.correctiveAction ? (
                    <div>
                      <dt>Accion correctiva</dt>
                      <dd>{result.patch.correctiveAction}</dd>
                    </div>
                  ) : null}
                  {result.patch.responsible ? (
                    <div>
                      <dt>Responsable</dt>
                      <dd>{result.patch.responsible}</dd>
                    </div>
                  ) : null}
                  {result.patch.dueDate ? (
                    <div>
                      <dt>Fecha limite</dt>
                      <dd>{result.patch.dueDate}</dd>
                    </div>
                  ) : null}
                  {result.excerpt ? (
                    <div>
                      <dt>Fragmento detectado</dt>
                      <dd>{result.excerpt}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </details>
          ))}
        </div>
      </section>

      <div className="step-footer voice-footer">
        <div className={`voice-footer-secondary ${hasProcessedResults ? 'has-continue' : ''}`}>
          <button className="secondary-action" onClick={onBack}>
            Volver
          </button>
          {hasProcessedResults ? (
            <button className="primary-action success-action" disabled={isProcessing} aria-label="Continuar con puntos identificados" onClick={() => onApply(processedResults)}>
              <CheckCircle2 size={18} aria-hidden="true" />
              Continuar
            </button>
          ) : null}
        </div>
        <button className="primary-action" disabled={isProcessing || (!audioBlob && !transcript.trim())} onClick={processWithAi}>
          <Sparkles size={18} aria-hidden="true" />
          {isProcessing ? 'Procesando con IA...' : 'Procesar y rellenar auditoria'}
        </button>
      </div>
    </motion.section>
  );
}

function StepProgress({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="step-progress" style={{ '--step-progress': current === 1 ? 0 : current === 2 ? 0.5 : 1 } as React.CSSProperties} aria-label={`Paso ${current} de 3`}>
      <li className={current >= 1 ? 'active' : ''}>
        <strong>1</strong>
        <span>Datos</span>
      </li>
      <li className={current >= 2 ? 'active' : ''}>
        <strong>2</strong>
        <span>Alcance</span>
      </li>
      <li className={current >= 3 ? 'active' : ''}>
        <strong>3</strong>
        <span>Auditoria</span>
      </li>
    </ol>
  );
}

function AuditProgressBar({ progress }: { progress: number }) {
  return (
    <div className="audit-progress-bar" aria-label={`Progreso auditado ${progress}%`}>
      <div>
        <span style={{ width: `${progress}%` }} />
      </div>
      <strong>{progress}% auditado</strong>
    </div>
  );
}

function ScopeGroup({
  group,
  selectedSet,
  initiallyOpen,
  onToggle,
  onSelectMany,
  onClearMany,
}: {
  group: ReturnType<typeof groupScopePoints>[number];
  selectedSet: Set<string>;
  initiallyOpen: boolean;
  onToggle: (pointId: string) => void;
  onSelectMany: (ids: string[]) => void;
  onClearMany: (ids: string[]) => void;
}) {
  const [open, setOpen] = React.useState(initiallyOpen);

  React.useEffect(() => {
    if (initiallyOpen) setOpen(true);
  }, [initiallyOpen]);

  return (
    <section className={`scope-group ${open ? 'open' : ''}`}>
      <button className="scope-group-summary" type="button" onClick={() => setOpen((current) => !current)}>
        <div>
          <strong>{group.name}</strong>
          <span>
            {group.selectedCount}/{group.points.length} seleccionados
          </span>
        </div>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="scope-group-body">
          <div className="scope-group-actions">
            <button onClick={() => onSelectMany(group.points.map((point) => point.id))}>Seleccionar grupo</button>
            <button onClick={() => onClearMany(group.points.map((point) => point.id))}>Limpiar grupo</button>
          </div>
          <div className="scope-group-items">
            {group.points.map((point) => (
              <label key={point.id} className="scope-item">
                <input name={`scope-${point.id}`} type="checkbox" checked={selectedSet.has(point.id)} onChange={() => onToggle(point.id)} />
                <span>
                  <strong>{point.code}</strong>
                  {point.ko ? <em>KO {point.ko}</em> : null}
                  <small>{point.sectionPath.slice(1).join(' / ') || point.sectionPath.join(' / ')}</small>
                  {pointRequirement(point)}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function groupScopePoints(points: StandardPoint[], selectedSet: Set<string>) {
  const groups = new Map<string, StandardPoint[]>();

  points.forEach((point) => {
    const chapter = point.sectionPath[0] || `Capitulo ${point.code.split('.')[0] || 'General'}`;
    if (!groups.has(chapter)) groups.set(chapter, []);
    groups.get(chapter)!.push(point);
  });

  return Array.from(groups.entries()).map(([name, groupPoints]) => ({
    name,
    points: groupPoints,
    selectedCount: groupPoints.filter((point) => selectedSet.has(point.id)).length,
  }));
}

function AuditHeader({
  metadata,
  auditMode,
  onEditData,
  onEditScope,
  onManualMode,
  onVoiceMode,
}: {
  metadata: AuditMetadata;
  auditMode: AuditMode;
  onEditData: () => void;
  onEditScope: () => void;
  onManualMode: () => void;
  onVoiceMode: () => void;
}) {
  return (
    <section className="audit-header">
      <div>
        <p className="eyebrow">Auditoria en curso</p>
        <h1>{metadata.company || 'Empresa sin nombre'}</h1>
        <p>
          {metadata.auditor || 'Auditor pendiente'} · {metadata.auditDate}
        </p>
      </div>
      <div className="audit-mode-switch" aria-label="Cambiar modo de auditoria">
        <button className={auditMode === 'manual' ? 'active' : ''} onClick={onManualMode}>
          <ListChecks size={16} aria-hidden="true" />
          Manual
        </button>
        <button className={auditMode === 'voice' ? 'active' : ''} onClick={onVoiceMode}>
          <Mic size={16} aria-hidden="true" />
          Automatica
        </button>
      </div>
      <button onClick={onEditScope}>
        <ListChecks size={18} aria-hidden="true" />
        Puntos
      </button>
      <button onClick={onEditData}>
        <Building2 size={18} aria-hidden="true" />
        Editar
      </button>
    </section>
  );
}

function AuditPointPanel({
  point,
  entry,
  index,
  total,
  points,
  onPrev,
  onNext,
  onSelectPoint,
  onUpdate,
}: {
  point: StandardPoint;
  entry: AuditEntry;
  index: number;
  total: number;
  points: StandardPoint[];
  onPrev: () => void;
  onNext: () => void;
  onSelectPoint: (pointId: string) => void;
  onUpdate: (patch: Partial<AuditEntry>) => void;
}) {
  return (
    <motion.section
      className="audit-panel"
      key={point.id}
      initial={{ opacity: 0, transform: 'translateY(8px)' }}
      animate={{ opacity: 1, transform: 'translateY(0)' }}
      transition={{ duration: 0.18, ease: smoothEase }}
    >
      <div className="point-nav">
        <button onClick={onPrev} disabled={index <= 0}>
          Anterior
        </button>
        <strong>
          Punto {index + 1} de {total}
        </strong>
        <button onClick={onNext} disabled={index >= total - 1}>
          Siguiente
        </button>
      </div>

      <label className="mobile-point-picker">
        <span>Requisito actual</span>
        <select value={point.id} onChange={(event) => onSelectPoint(event.target.value)}>
          {points.map((item) => (
            <option key={item.id} value={item.id}>
              {compactPointLabel(item)}
            </option>
          ))}
        </select>
      </label>

      <div className="panel-header">
        <div>
          <h2>{pointHeading(point)}</h2>
          <p className="section-path">{point.sectionPath.join(' / ') || 'Norma'}</p>
        </div>
        <div className="badge-row">
          {point.ko ? <span className="badge danger">KO {point.ko}</span> : null}
          <span className={point.mandatory ? 'badge danger' : 'badge'}>{point.mandatory ? 'Obligatorio' : 'Omitible'}</span>
          {point.requiresReportInfo ? <span className="badge warn">Info informe</span> : null}
          {point.page ? <span className="badge">Pag. {point.page}</span> : null}
        </div>
      </div>

      <article className="requirement">
        <span>Requisito</span>
        <p>{pointRequirement(point)}</p>
      </article>

      <div className="status-grid">
        {auditActionStatuses.map((status) => (
          <button
            key={status}
            className={entry.status === status ? 'selected' : ''}
            style={{ borderColor: entry.status === status ? statusColors[status] : undefined }}
            onClick={() => onUpdate({ status })}
          >
            {statusLabels[status]}
          </button>
        ))}
      </div>

      <div className="form-grid">
        <Textarea name="audit-comment" label="Comentario de auditoria" value={entry.comment} onChange={(value) => onUpdate({ comment: value })} />
        <Textarea name="audit-extra-data" label="Datos adicionales" value={entry.extraData} onChange={(value) => onUpdate({ extraData: value })} />
        <Textarea name="audit-evidence" label="Evidencias" value={entry.evidence} onChange={(value) => onUpdate({ evidence: value })} />
        <Textarea name="audit-corrective-action" label="Accion correctiva" value={entry.correctiveAction} onChange={(value) => onUpdate({ correctiveAction: value })} />
        <label>
          <span>Responsable</span>
          <input name="corrective-responsible" autoComplete="name" value={entry.responsible} onChange={(event) => onUpdate({ responsible: event.target.value })} />
        </label>
        <label>
          <span>Fecha limite</span>
          <input name="corrective-due-date" autoComplete="off" type="date" value={entry.dueDate} onChange={(event) => onUpdate({ dueDate: event.target.value })} />
        </label>
      </div>
    </motion.section>
  );
}

function MetadataForm({
  metadata,
  setMetadata,
}: {
  metadata: AuditMetadata;
  setMetadata: React.Dispatch<React.SetStateAction<AuditMetadata>>;
}) {
  const fields = [
    { key: 'company', label: 'Empresa', name: 'organization', autoComplete: 'organization', type: 'text' },
    { key: 'site', label: 'Centro', name: 'site', autoComplete: 'off', type: 'text' },
    { key: 'auditor', label: 'Auditor', name: 'auditor', autoComplete: 'name', type: 'text' },
    { key: 'auditDate', label: 'Fecha', name: 'audit-date', autoComplete: 'off', type: 'date' },
  ] as const;

  return (
    <div className="metadata-grid form-surface">
      {fields.map((field) => (
        <label key={field.key}>
          <span>{field.label}</span>
          <input
            type={field.type}
            name={field.name}
            autoComplete={field.autoComplete}
            value={metadata[field.key]}
            onChange={(event) => setMetadata((current) => ({ ...current, [field.key]: event.target.value }))}
          />
        </label>
      ))}
    </div>
  );
}

function StatsView({ summary, chartData }: { summary: ReturnType<typeof summarize>; chartData: Array<{ name: string; value: number; color: string }> }) {
  return (
    <section className="single-panel">
      <div className="card-heading">
        <h2>Estado de la Auditoria</h2>
        <p>Resumen del avance y puntos pendientes.</p>
      </div>
      <section className="summary-grid">
        <Metric icon={<ClipboardCheck aria-hidden="true" />} label="Progreso" value={`${summary.progress}%`} detail={`${summary.evaluated}/${summary.total} revisados`} />
        <Metric icon={<CheckCircle2 aria-hidden="true" />} label="Cumplimiento" value={`${summary.compliance}%`} detail={`${summary.passed} conformes`} />
        <Metric icon={<XCircle aria-hidden="true" />} label="No conformes" value={String(summary.failed)} detail={`${summary.mandatoryFailed} KO/obligatorios fallan`} />
        <Metric icon={<AlertTriangle aria-hidden="true" />} label="Pendientes" value={String(summary.pending)} detail="Por completar" />
      </section>
      <aside className="insights stats-card">
        <h3>Estado de la auditoria</h3>
        <div className="chart">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie dataKey="value" data={chartData} innerRadius={62} outerRadius={92} paddingAngle={3}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="legend">
          {chartData.map((item) => (
            <span key={item.name}>
              <i style={{ background: item.color }} />
              {item.name}: {item.value}
            </span>
          ))}
        </div>
      </aside>
    </section>
  );
}

function BottomNav({
  activeView,
  setActiveView,
  onExport,
}: {
  activeView: AppView;
  setActiveView: (view: AppView) => void;
  onExport: () => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Navegacion principal">
      <button className={activeView === 'audit' ? 'active' : ''} aria-label="Auditar" onClick={() => setActiveView('audit')}>
        <ListChecks size={20} aria-hidden="true" />
        <span>Auditar</span>
      </button>
      <button className={activeView === 'scope' ? 'active' : ''} aria-label="Puntos" onClick={() => setActiveView('scope')}>
        <ClipboardCheck size={20} aria-hidden="true" />
        <span>Puntos</span>
      </button>
      <button className={activeView === 'data' ? 'active' : ''} aria-label="Datos" onClick={() => setActiveView('data')}>
        <Building2 size={20} aria-hidden="true" />
        <span>Datos</span>
      </button>
      <button className={activeView === 'stats' ? 'active' : ''} aria-label="Estado" onClick={() => setActiveView('stats')}>
        <BarChart3 size={20} aria-hidden="true" />
        <span>Estado</span>
      </button>
      <button aria-label="Exportar Excel" onClick={onExport}>
        <Download size={20} aria-hidden="true" />
        <span>Excel</span>
      </button>
    </nav>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="metric">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function Textarea({ name, label, value, onChange }: { name: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="wide">
      <span>{label}</span>
      <textarea name={name} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} rows={4} />
    </label>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
