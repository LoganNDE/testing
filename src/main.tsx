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
  Search,
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

type WorkflowStep = 'company' | 'scope' | 'audit';
type AppView = 'audit' | 'scope' | 'data' | 'stats';

const STORAGE_KEY = 'ifs-hpc-audit-state-v5';
const bundledPoints = parseStandardJson(ifsHpcStandard);

const statusColors: Record<AuditStatus, string> = {
  pending: '#64748b',
  pass: '#15803d',
  fail: '#b91c1c',
  omit: '#a16207',
  not_applicable: '#0369a1',
};

const smoothEase: [number, number, number, number] = [0.23, 1, 0.32, 1];

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

  const auditPoints = React.useMemo(() => {
    const selected = new Set(selectedIds);
    return points.filter((point) => selected.has(point.id));
  }, [points, selectedIds]);

  const selected = auditPoints.find((point) => point.id === selectedId) ?? auditPoints[0];
  const selectedEntry = selected ? entries[selected.id] ?? emptyEntry() : emptyEntry();
  const summary = summarize(auditPoints, entries);
  const selectedIndex = selected ? auditPoints.findIndex((point) => point.id === selected.id) : -1;

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ points, entries, selectedIds, selectedId, metadata, workflowStep }));
  }, [points, entries, selectedIds, selectedId, metadata, workflowStep]);

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
    { name: 'Pasa', value: summary.passed, color: statusColors.pass },
    { name: 'No pasa', value: summary.failed, color: statusColors.fail },
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
    setWorkflowStep('audit');
    setActiveView('audit');
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
          onStart={startAudit}
          onImport={handleImport}
        />
      )}

      {workflowStep === 'audit' && (
        <>
          <AuditHeader metadata={metadata} summary={summary} onEditData={() => setActiveView('data')} onEditScope={() => setActiveView('scope')} />

          <div className="mobile-progress" aria-label="Progreso de auditoria">
            <span style={{ width: `${summary.progress}%` }} />
          </div>

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
                      <button key={point.id} className={point.id === selected.id ? 'active' : ''} onClick={() => setSelectedId(point.id)}>
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
                onPrev={() => goToPoint(-1)}
                onNext={() => goToPoint(1)}
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
      <div className="step-hero app-intro">
        <div className="brand-mark" aria-hidden="true">
          IFS
        </div>
        <span className="step-pill">Paso 1 de 2</span>
        <h1>Prepara la Auditoria</h1>
        <p className="step-copy">Configura los datos base y define el alcance antes de entrar punto por punto.</p>
        <StepProgress current={1} />
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
}) {
  const [scopeQuery, setScopeQuery] = React.useState('');
  const filtered = points.filter((point) => {
    const text = `${point.code} ${point.title} ${pointRequirement(point)} ${point.sectionPath.join(' ')}`.toLowerCase();
    return text.includes(scopeQuery.toLowerCase());
  });
  const selectedSet = new Set(selectedIds);
  const groups = groupScopePoints(filtered, selectedSet);

  return (
    <motion.section className="step-screen wide-step" {...softEnter}>
      <div className="scope-header">
        <div>
          <span className="step-pill">Paso 2 de 2</span>
          <h1>{title}</h1>
          <p className="step-copy">{description}</p>
          <StepProgress current={2} />
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

function StepProgress({ current }: { current: 1 | 2 }) {
  return (
    <div className="step-progress" aria-label={`Paso ${current} de 2`}>
      <span className={current >= 1 ? 'active' : ''}>Datos</span>
      <i />
      <span className={current >= 2 ? 'active' : ''}>Alcance</span>
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
  summary,
  onEditData,
  onEditScope,
}: {
  metadata: AuditMetadata;
  summary: ReturnType<typeof summarize>;
  onEditData: () => void;
  onEditScope: () => void;
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
      <button onClick={onEditScope}>
        <ListChecks size={18} aria-hidden="true" />
        Puntos
      </button>
      <button onClick={onEditData}>
        <Building2 size={18} aria-hidden="true" />
        Editar
      </button>
      <strong>{summary.progress}%</strong>
    </section>
  );
}

function AuditPointPanel({
  point,
  entry,
  index,
  total,
  onPrev,
  onNext,
  onUpdate,
}: {
  point: StandardPoint;
  entry: AuditEntry;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
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
        {(Object.keys(statusLabels) as AuditStatus[]).map((status) => (
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
        <Metric icon={<CheckCircle2 aria-hidden="true" />} label="Cumplimiento" value={`${summary.compliance}%`} detail={`${summary.passed} puntos pasan`} />
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
      <button className={activeView === 'audit' ? 'active' : ''} onClick={() => setActiveView('audit')}>
        <ListChecks size={20} aria-hidden="true" />
        <span>Auditar</span>
      </button>
      <button className={activeView === 'scope' ? 'active' : ''} onClick={() => setActiveView('scope')}>
        <ClipboardCheck size={20} aria-hidden="true" />
        <span>Puntos</span>
      </button>
      <button className={activeView === 'data' ? 'active' : ''} onClick={() => setActiveView('data')}>
        <Building2 size={20} aria-hidden="true" />
        <span>Datos</span>
      </button>
      <button className={activeView === 'stats' ? 'active' : ''} onClick={() => setActiveView('stats')}>
        <BarChart3 size={20} aria-hidden="true" />
        <span>Estado</span>
      </button>
      <button onClick={onExport}>
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
