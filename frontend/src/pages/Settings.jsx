import React, { useEffect, useState, useCallback } from 'react';
import { isTauri as _isTauri } from '../utils/media';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Cpu, FileText, Info, ShieldCheck, RefreshCw, Trash2, ExternalLink,
  CheckCircle, AlertCircle, Plug, Download, Copy, Building2, KeyRound,
  Keyboard,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { openExternal } from '../api/external';
import { systemLogs, systemLogsTauri, clearSystemLogs, clearTauriLogs } from '../api/system';
import { useSysinfo, useModelStatus, useSystemInfo } from '../api/hooks';
import { selectEngine } from '../api/engines';
import { setupDownloadStreamUrl } from '../api/setup';
import { getFrontendLogs, clearFrontendLogs } from '../utils/consoleBuffer';
import { Tabs, Segmented, Button, Badge, Panel, Table, Progress } from '../ui';
import { useAppStore } from '../store';
import ApiKeysPanel from '../components/settings/ApiKeysPanel';
import PerformancePanel from '../components/settings/PerformancePanel';
import AppearancePanel from '../components/settings/AppearancePanel';
import EngineCompatibilityMatrix from '../components/EngineCompatibilityMatrix';
import './Settings.css';

const TABS = (t) => [
  { id: 'models',      label: t('settings.models'),      icon: Cpu,          accent: '#f3a5b6' },
  { id: 'engines',     label: t('settings.engines'),     icon: Plug,         accent: '#d3869b' },
  { id: 'capture',     label: t('settings.capture'),     icon: Keyboard,     accent: '#83a598' },
  { id: 'credentials', label: t('settings.credentials'), icon: KeyRound,     accent: '#fe8019' },
  { id: 'logs',        label: t('settings.logs'),        icon: FileText,     accent: '#fabd2f' },
  { id: 'about',       label: t('settings.about'),       icon: Info,         accent: '#8ec07c' },
  { id: 'privacy',     label: t('settings.privacy'),     icon: ShieldCheck,  accent: '#b8bb26' },
];

const LOG_SOURCES = (t) => [
  { value: 'backend',  label: t('settings.backend') },
  { value: 'frontend', label: t('settings.frontend') },
  { value: 'tauri',    label: t('settings.tauri') },
];

const MODEL_ROLE_ORDER = ['tts', 'asr', 'diarisation', 'diarization', 'llm'];
const MODEL_ROLE_LABEL = { all: 'Tất cả', tts: 'TTS', asr: 'ASR', diarisation: 'Diarisation', diarization: 'Diarisation', llm: 'LLM', other: 'Khác' };

function Row({ label, value, mono }) {
  return (
    <div className="settings-row">
      <span className="label">{label}</span>
      <span className={`value ${mono ? 'settings-row__mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function fmtBytes(n) {
  if (n == null || n < 0) return '—';
  if (n === 0) return '0 B';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/** Màu HSL tĩnh từ tên tổ chức/người dùng trong repo_id. */
function orgColor(repoId) {
  const org = (repoId || '').split('/')[0];
  let h = 0;
  for (let i = 0; i < org.length; i++) h = (h * 31 + org.charCodeAt(i)) & 0xffff;
  return `hsl(${h % 360}, 35%, 28%)`;
}

import { useModels, useRecommendations, useInstallModel, useDeleteModel } from '../api/hooks';

/**
 * Model store — liệt kê mọi mô hình HF đã biết, hiển thị trạng thái cài đặt, cho phép
 * người dùng cài đặt / cài đặt lại / xóa từng mô hình. Tiến trình tải xuống của từng mô hình
 * được lấy từ SSE /setup/download-stream dùng chung.
 */
export function ModelStoreTab({ info, modelBadge }) {
  const { t } = useTranslation();
  const modelsQuery = useModels();
  const recoQuery = useRecommendations();
  const data = modelsQuery.data;
  const loading = modelsQuery.isLoading;
  const reco = recoQuery.data;
  const installMutation = useInstallModel();
  const deleteMutation = useDeleteModel();

  const [busy, setBusy] = useState(new Set()); // repo_ids hiện đang xử lý
  // Trạng thái hoạt động trên từng repo. Theo dõi tổng lượng tải xuống trên tất cả các tệp của
  // một cài đặt đang chạy để hàng có thể hiển thị thanh tiến trình xác định.
  // { [repo_id]: { phase, files: { [filename]: { downloaded, total, pct } }, error } }
  const [rowState, setRowState] = useState({});
  const [query, setQuery] = useState('');
  const [installingReco, setInstallingReco] = useState(false);
  const [activeRole, setActiveRole] = useState(null);
  const [sorting, setSorting] = useState([]);
  const [columnFilters, setColumnFilters] = useState([]);
  const esRef = React.useRef(null);
  const tableBodyRef = React.useRef(null);
  // Theo dõi tốc độ tải xuống trên từng repo: { [repo_id]: { lastBytes, lastTime, speed } }
  const speedRef = React.useRef({});
  // Bộ đếm nhịp — buộc render lại mỗi giây trong khi đang tải xuống
  // để hiển thị tốc độ/ETA cập nhật mượt mà giữa các sự kiện SSE.
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasActive = Object.values(rowState).some(s =>
      ['install_start', 'active', 'delete_start'].includes(s.phase));
    if (!hasActive) return;
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, [rowState]);

  // HF token nội dòng — input nhỏ gọn trong thanh công cụ
  const [hfToken, setHfToken] = useState('');
  const [hfSaved, setHfSaved] = useState(false);
  const [hfSaving, setHfSaving] = useState(false);
  const [hfExpanded, setHfExpanded] = useState(false);
  const saveHfToken = async () => {
    const value = hfToken.trim();
    if (!value) return;
    setHfSaving(true);
    try {
      const { API } = await import('../api/client');
      const res = await fetch(`${API}/system/set-env`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'HF_TOKEN', value }),
      });
      if (res.ok) {
        toast.success('Đã đặt HuggingFace token — cho phép tải xuống nhanh hơn');
        setHfSaved(true);
        setHfToken('');
        setHfExpanded(false);
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.detail || 'Không thể lưu token');
      }
    } catch (e) { toast.error(`Lưu thất bại: ${e.message}`); }
    finally { setHfSaving(false); }
  };
  const hfTokenSet = hfSaved || info?.has_hf_token;

  // Mở stream tiến trình một lần khi tab mount; đóng khi unmount.
  useEffect(() => {
    const es = new EventSource(setupDownloadStreamUrl());
    esRef.current = es;
    es.onmessage = (evt) => {
      try {
        const ev = JSON.parse(evt.data);
        if (!ev?.repo_id) return;
        setRowState(prev => {
          const cur = prev[ev.repo_id] || { phase: 'active', files: {} };
          // Các sự kiện vòng đời (install_start/install_done/install_error,
          // delete_start/delete_done) chuyển đổi phase của hàng mà không
          // ảnh hưởng đến việc hạch toán từng tệp.
          if (ev.phase === 'install_start' || ev.phase === 'delete_start') {
            return { ...prev, [ev.repo_id]: { phase: ev.phase, files: {}, error: null } };
          }
          // Nhịp tim từ backend trong khi giải quyết metadata repo
          if (ev.phase === 'resolving') {
            return { ...prev, [ev.repo_id]: { ...cur, phase: 'resolving', resolvingStep: ev.step || 0 } };
          }
          if (ev.phase === 'install_retry') {
            return { ...prev, [ev.repo_id]: { ...cur, phase: 'install_retry', retryAttempt: ev.attempt, error: ev.error } };
          }
          if (ev.phase === 'install_done') {
            return { ...prev, [ev.repo_id]: { ...cur, phase: 'install_done' } };
          }
          if (ev.phase === 'delete_done') {
            return { ...prev, [ev.repo_id]: { ...cur, phase: 'delete_done' } };
          }
          if (ev.phase === 'install_error') {
            return { ...prev, [ev.repo_id]: { ...cur, phase: 'install_error', error: ev.error } };
          }
          // Các sự kiện tqdm trên từng tệp — tổng hợp lại.
          const files = { ...cur.files, [ev.filename]: {
            downloaded: ev.downloaded || 0,
            total: ev.total || 0,
            pct: ev.pct || 0,
            phase: ev.phase,
            rate: ev.rate || 0,
          }};
          return { ...prev, [ev.repo_id]: { ...cur, phase: 'active', files } };
        });
      } catch { /* keepalive / bỏ qua */ }
    };
    return () => es.close();
  }, []);

  // Khi một sự kiện kết thúc vòng đời được kích hoạt, làm mới danh sách để "đã cài đặt"
  // cập nhật thông tin từ phía máy chủ vào hàng.
  useEffect(() => {
    const term = Object.entries(rowState).find(([, s]) =>
      ['install_done', 'delete_done', 'install_error'].includes(s.phase));
    if (!term) return;
    const t = setTimeout(() => {
      modelsQuery.refetch();
      recoQuery.refetch();
      // Xóa dữ liệu tốc độ cũ của repo này.
      delete speedRef.current[term[0]];
      // Xóa mục kết thúc để hàng quay lại sử dụng cờ `installed` có thẩm quyền
      // từ /models mà không giữ lại tiến trình cũ.
      setRowState(prev => {
        const next = { ...prev };
        delete next[term[0]];
        return next;
      });
    }, 800);
    return () => clearTimeout(t);
  }, [rowState, modelsQuery, recoQuery]);

  const reload = useCallback(() => {
    modelsQuery.refetch();
    recoQuery.refetch();
  }, [modelsQuery, recoQuery]);

  const withBusy = useCallback(async (repoId, fn, successMsg) => {
    setBusy(prev => new Set(prev).add(repoId));
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
    } catch (e) {
      toast.error(e.message || String(e));
    } finally {
      setBusy(prev => { const s = new Set(prev); s.delete(repoId); return s; });
    }
  }, []);

  const onInstall = useCallback((repoId) =>
    withBusy(repoId, () => installMutation.mutateAsync(repoId), 'Đã bắt đầu cài đặt — xem tiến trình trong hàng'),
    [installMutation, withBusy]);
  const onDelete = useCallback(async (repoId) => {
    if (!(await askConfirm(`Xóa ${repoId}? Bạn có thể cài đặt lại sau.`, 'Xóa mô hình'))) return;
    return withBusy(repoId, () => deleteMutation.mutateAsync(repoId), `Đã xóa ${repoId}`);
  }, [deleteMutation, withBusy]);
  const onReinstall = useCallback(async (repoId) => {
    if (!(await askConfirm(`Cài đặt lại ${repoId}? Thao tác này sẽ xóa bản sao hiện tại và tải xuống lại.`, 'Cài đặt lại mô hình'))) return;
    await withBusy(repoId, async () => {
      await deleteMutation.mutateAsync(repoId);
      await installMutation.mutateAsync(repoId);
    }, 'Đang cài đặt lại');
  }, [deleteMutation, installMutation, withBusy]);

  const onInstallRecommended = async () => {
    if (!reco) return;
    const missing = reco.models.filter(m => !m.installed);
    if (missing.length === 0) {
      toast.success('Các mô hình được khuyến nghị đã được cài đặt.');
      return;
    }
    setInstallingReco(true);
    try {
      // Cài đặt song song — backend /models/install kích hoạt từng bản tải xuống trên
      // task asyncio riêng nên thứ tự không quan trọng.
      await Promise.all(missing.map(m => installMutation.mutateAsync(m.repo_id)));
      toast.success(`Đã bắt đầu tải xuống ${missing.length} mô hình`);
    } catch (e) {
      toast.error(`Cài đặt thất bại: ${e.message || e}`);
    } finally {
      setInstallingReco(false);
    }
  };

  const allModels = React.useMemo(() => data?.models || [], [data]);
  const groups = allModels.reduce((acc, m) => {
    const k = (m.role || 'other').toLowerCase();
    (acc[k] = acc[k] || []).push(m);
    return acc;
  }, {});
  const roles = Object.keys(groups).sort((a, b) => {
    const ai = MODEL_ROLE_ORDER.indexOf(a), bi = MODEL_ROLE_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  // 'all' là một vai trò ảo — hiển thị mọi mô hình bất kể danh mục.
  const currentRole = activeRole === 'all' ? 'all'
    : activeRole && groups[activeRole] ? activeRole
    : 'all';

  const allInstalled = allModels.filter(m => m.installed).length;

  useEffect(() => {
    setColumnFilters(currentRole === 'all' ? [] : [{ id: 'role', value: currentRole }]);
  }, [currentRole]);

  const getRowRuntime = React.useCallback((m) => {
    const rs = rowState[m.repo_id];
    const rowBusy = busy.has(m.repo_id);
    const isInstalling = rs?.phase === 'install_start' || (rs?.phase === 'active' && !rs.files && !rs.error);
    const isDeleting = rs?.phase === 'delete_start';
    const phase = rs?.phase;
    const fileList = rs?.files ? Object.entries(rs.files) : [];
    const totals = fileList.reduce((a, [, f]) => ({
      downloaded: a.downloaded + (f.downloaded || 0),
      total: a.total + (f.total || 0),
      done: a.done + (f.phase === 'done' ? 1 : 0),
    }), { downloaded: 0, total: 0, done: 0 });
    // Tổng hợp tốc độ do backend báo cáo từ các tệp đang hoạt động (chưa hoàn thành)
    const backendRate = fileList
      .filter(([, f]) => f.phase !== 'done' && f.rate > 0)
      .reduce((s, [, f]) => s + f.rate, 0);
    const hasFiles = fileList.length > 0;
    const aggPct = totals.total > 0 ? (totals.downloaded / totals.total) * 100 : null;
    const showBar = ['install_start', 'resolving', 'install_retry', 'active', 'delete_start'].includes(phase);
    const activeFilename = fileList.find(([, f]) => f.phase !== 'done')?.[0];
    const unsupported = m.supported === false;

    return {
      rs,
      rowBusy,
      isInstalling,
      isDeleting,
      phase,
      fileList,
      totals,
      hasFiles,
      aggPct,
      showBar,
      activeFilename,
      unsupported,
      backendRate,
    };
  }, [busy, rowState]);

  const columns = React.useMemo(() => [
    {
      id: 'name',
      accessorFn: m => `${m.label || ''} ${m.repo_id || ''}`,
      header: 'Mô hình (Model)',
      size: 260,
      meta: { className: 'models-row__name' },
      cell: ({ row }) => {
        const m = row.original;
        const rt = getRowRuntime(m);
        return (
          <>
            <span className="models-row__title">
              <span
                className="models-row__avatar"
                style={{ background: orgColor(m.repo_id) }}
                title={m.repo_id.split('/')[0]}
              >
                {m.repo_id.split('/')[0].slice(0, 2).toUpperCase()}
              </span>
              {m.label}
              {m.required && <span className="models-row__tag">bắt buộc</span>}
            </span>
            <span className="models-row__repo">
              <code>{m.repo_id}</code>
              {m.note && <span className="models-row__note"> · {m.note}</span>}
            </span>
            {rt.showBar && (
              <div className="models-row__progressline">
                <Progress
                  value={rt.aggPct}
                  tone={rt.isDeleting ? 'warn' : 'brand'}
                  size="xs"
                />
                <span className="models-row__progresstext">
                  {(() => {
                    if (rt.isDeleting) return 'Đang xóa các bản sửa đổi đã lưu…';
                    if (!rt.hasFiles) {
                      if (rt.phase === 'resolving') {
                        const dots = '.'.repeat((rt.rs?.resolvingStep || 0) % 4);
                        return `Đang giải quyết metadata repo${dots}`;
                      }
                      if (rt.phase === 'install_retry') {
                        return `Lần thử lại ${rt.rs?.retryAttempt || '?'} — ${rt.rs?.error || 'đang kết nối lại'}`;
                      }
                      return 'Đang kết nối tới HuggingFace…';
                    }

                    // Có sự kiện tệp — tính toán tốc độ
                    const sp = speedRef.current[m.repo_id];
                    const now = Date.now();
                    if (sp && rt.totals.downloaded > 0) {
                      const dt = (now - sp.lastTime) / 1000;
                      if (dt >= 1) {
                        sp.speed = Math.max(0, (rt.totals.downloaded - sp.lastBytes) / dt);
                        sp.lastBytes = rt.totals.downloaded;
                        sp.lastTime = now;
                      }
                    } else {
                      speedRef.current[m.repo_id] = { lastBytes: rt.totals.downloaded, lastTime: now, speed: 0 };
                    }
                    const speed = rt.backendRate > 0 ? rt.backendRate : (sp?.speed || 0);

                    // Nếu không biết tổng số và chưa tải gì → vẫn đang giải quyết
                    if (rt.totals.total === 0 && rt.totals.downloaded === 0) {
                      const activeFile = rt.activeFilename?.split('/').pop();
                      return activeFile
                        ? `Đang giải quyết ${rt.fileList.length} tệp… · ${activeFile}`
                        : `Đang giải quyết ${rt.fileList.length} tệp…`;
                    }

                    // Xây dựng dòng thông tin
                    const remaining = rt.totals.total - rt.totals.downloaded;
                    const etaSec = speed > 0 && rt.totals.total > 0 ? remaining / speed : 0;
                    const etaStr = etaSec > 0
                      ? etaSec < 60 ? `~${Math.ceil(etaSec)} giây`
                      : etaSec < 3600 ? `~${Math.ceil(etaSec / 60)} phút`
                      : `~${(etaSec / 3600).toFixed(1)} giờ`
                      : '';
                    const dlStr = fmtBytes(rt.totals.downloaded) || '0 B';
                    const totalStr = rt.totals.total > 0 ? fmtBytes(rt.totals.total) : '…';
                    const pctStr = rt.aggPct != null && rt.aggPct > 0 ? `${Math.round(rt.aggPct)}%` : '';
                    const speedStr = speed > 0 ? `${fmtBytes(speed)}/s` : '';

                    const parts = [
                      `${dlStr} / ${totalStr}`,
                      pctStr,
                      speedStr || (rt.totals.downloaded > 0 ? 'đang đo…' : ''),
                      etaStr,
                    ].filter(Boolean);

                    const extra = [];
                    if (rt.fileList.length > 1) extra.push(`${rt.totals.done}/${rt.fileList.length} tệp`);
                    if (rt.activeFilename) extra.push(rt.activeFilename.split('/').pop());

                    return extra.length
                      ? `${parts.join(' · ')}  ⸱  ${extra.join(' · ')}`
                      : parts.join(' · ');
                  })()}
                </span>
              </div>
            )}
            {rt.phase === 'install_error' && rt.rs?.error && (
              <span className="models-row__error">Cài đặt thất bại: {rt.rs.error}</span>
            )}
          </>
        );
      },
    },
    {
      id: 'role',
      accessorFn: m => (m.role || 'other').toLowerCase(),
      header: 'Vai trò',
      size: 58,
      filterFn: (row, id, value) => !value || row.getValue(id) === value,
      cell: ({ row }) => <span className="models-row__role">{MODEL_ROLE_LABEL[row.getValue('role')] || row.original.role || 'Khác'}</span>,
    },
    {
      id: 'size',
      accessorFn: m => m.installed ? (m.size_on_disk_bytes || 0) : (m.size_gb || 0) * 1024 ** 3,
      header: 'Kích thước',
      size: 68,
      meta: { align: 'right', className: 'models-row__size' },
      cell: ({ row }) => {
        const m = row.original;
        const rt = getRowRuntime(m);
        // Trong khi tải xuống tích cực, hiển thị số byte đã tải / tổng số
        if (rt.showBar && rt.hasFiles && rt.totals.total > 0) {
          return <span className="models-row__size-live">{fmtBytes(rt.totals.downloaded)}<span className="models-row__size-sep">/</span>{fmtBytes(rt.totals.total)}</span>;
        }
        return m.installed ? fmtBytes(m.size_on_disk_bytes) : `${m.size_gb} GB`;
      },
    },
    {
      id: 'status',
      accessorFn: m => m.installed ? 2 : (m.supported === false ? 0 : 1),
      header: 'Trạng thái',
      size: 96,
      meta: { align: 'center', className: 'models-row__status' },
      cell: ({ row }) => {
        const m = row.original;
        const rt = getRowRuntime(m);
        return rt.isInstalling
          ? <Badge tone="warn" size="xs"><Download size={10} /> {rt.aggPct != null ? `${Math.round(rt.aggPct)}%` : t('settings.downloading')}</Badge>
          : rt.isDeleting
            ? <Badge tone="warn" size="xs"><Trash2 size={10} /> đang xóa</Badge>
            : rt.rowBusy
              ? <Badge tone="warn" size="xs"><RefreshCw size={10} className="spinner" /> đang xử lý</Badge>
              : m.installed
                ? <Badge tone="success" size="xs">{t('settings.installed')}</Badge>
                : rt.unsupported
                  ? <Badge tone="neutral" size="xs">{(m.platforms || []).join(', ')}</Badge>
                  : <Badge tone="neutral" size="xs">{t('settings.not_installed')}</Badge>;
      },
    },
    {
      id: 'actions',
      header: '',
      size: 90,
      enableSorting: false,
      meta: { align: 'right', className: 'models-row__actions' },
      cell: ({ row }) => {
        const m = row.original;
        const rt = getRowRuntime(m);
        return (
          <>
            <Button
              variant="icon" iconSize="sm"
              onClick={() => openExternal(`https://huggingface.co/${m.repo_id}`)}
              title={t('settings.view_hf')}
              aria-label={t('settings.view_hf')}
            >
              <ExternalLink size={11} />
            </Button>
            {!m.installed && !rt.rowBusy && !rt.isInstalling && !rt.unsupported && (
              <Button
                variant="subtle" size="sm"
                onClick={() => onInstall(m.repo_id)}
                leading={<Download size={11} />}
              >
                {t('settings.install')}
              </Button>
            )}
            {m.installed && !rt.rowBusy && !rt.isDeleting && (
              <>
                <Button
                  variant="icon" iconSize="sm"
                  onClick={() => onReinstall(m.repo_id)}
                  title={t('settings.reinstall')}
                  aria-label={t('settings.reinstall')}
                >
                  <RefreshCw size={11} />
                </Button>
                <Button
                  variant="icon" iconSize="sm"
                  onClick={() => onDelete(m.repo_id)}
                  title={t('settings.delete')}
                  aria-label={t('settings.delete')}
                >
                  <Trash2 size={11} />
                </Button>
              </>
            )}
          </>
        );
      },
    },
  ], [getRowRuntime, onDelete, onInstall, onReinstall, t]);

  const table = useReactTable({
    data: allModels,
    columns,
    getRowId: row => row.repo_id,
    state: {
      sorting,
      globalFilter: query,
      columnFilters,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn: (row, _columnId, value) => {
      const q = String(value || '').trim().toLowerCase();
      if (!q) return true;
      const m = row.original;
      return [m.repo_id, m.label, m.note, m.role]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q));
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const tableRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => tableBodyRef.current,
    estimateSize: () => 68,
    overscan: 8,
  });

  if (loading && !data) {
    return (
      <section className="settings-section">
        <h2><Cpu size={16} color="#f3a5b6" /> {t('settings.models')}</h2>
        <div className="settings-muted">{t('common.loading')}</div>
      </section>
    );
  }
  if (!data) return null;

  return (
    <section className="settings-section settings-section--compact">
      <div className="models-toolbar">
        <div className="models-toolbar__stats">
          <span><strong>{fmtBytes(data.total_installed_bytes)}</strong></span>
          <span className="models-toolbar__sep">·</span>
          <span className="models-toolbar__cache" title={data.hf_cache_dir}><code>{data.hf_cache_dir?.replace(/^\/Users\/[^/]+/, '~')}</code></span>
          {info && <span className="models-toolbar__sep">·</span>}
          {info && <span>{modelBadge}</span>}
        </div>
        <div className="models-toolbar__actions">
          {/* Compact HF token inline */}
          {!hfTokenSet && !hfExpanded && (
            <button
              className="models-toolbar__hf-btn"
              onClick={() => setHfExpanded(true)}
              title="Đặt HuggingFace token để tải xuống nhanh hơn"
            >
              <KeyRound size={11} /> HF Token
            </button>
          )}
          {!hfTokenSet && hfExpanded && (
            <div className="models-toolbar__hf-row">
              <input
                type="password"
                className="models-toolbar__hf-input"
                placeholder="hf_xxxxxxxxxxxx"
                value={hfToken}
                onChange={e => setHfToken(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveHfToken(); if (e.key === 'Escape') setHfExpanded(false); }}
                autoFocus
              />
              <Button size="sm" variant="subtle" onClick={saveHfToken} disabled={hfSaving || !hfToken.trim()} loading={hfSaving}>
                {t('common.save')}
              </Button>
              <a
                href="#"
                className="models-toolbar__hf-link"
                onClick={e => { e.preventDefault(); openExternal('https://huggingface.co/settings/tokens'); }}
                title="Mở huggingface.co/settings/tokens"
              >
                Lấy token →
              </a>
            </div>
          )}
          {hfTokenSet && (
            <span className="models-toolbar__hf-ok"><KeyRound size={10} /> ✓</span>
          )}
          <Button variant="subtle" size="sm" onClick={reload} loading={loading} leading={<RefreshCw size={11} />}>
            {t('settings.refresh')}
          </Button>
        </div>
      </div>

      {reco && reco.all_installed && (
        <div className="reco-banner reco-banner--ok">
          <CheckCircle size={12} color="#8ec07c" />
          <span className="flex-1">Gói mô hình khuyến nghị đã cài đặt cho <strong>{reco.device.label}</strong></span>
          <span className="reco-banner__gb">{reco.total_gb} GB</span>
        </div>
      )}
      {reco && !reco.all_installed && (
        <div className="reco-banner reco-banner--pending">
          <div className="reco-banner__top">
            <span className="reco-banner__title">Khuyến nghị cho {reco.device.label}</span>
            <div className="reco-banner__btns">
              {(() => {
                const requiredMissing = reco.models.filter(m => m.required && !m.installed);
                const requiredGb = requiredMissing.reduce((s, m) => s + m.size_gb, 0);
                if (requiredMissing.length === 0) return null;
                return (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      setInstallingReco(true);
                      try {
                        await Promise.all(requiredMissing.map(m => installMutation.mutateAsync(m.repo_id)));
                        toast.success(`Đã bắt đầu tải xuống ${requiredMissing.length} mô hình bắt buộc`);
                      } catch (e) { toast.error(`Cài đặt thất bại: ${e.message || e}`); }
                      finally { setInstallingReco(false); }
                    }}
                    disabled={installingReco}
                    leading={installingReco ? <RefreshCw size={12} className="spinner" /> : null}
                  >
                    {installingReco ? 'Đang bắt đầu…' : `Bắt buộc ~${requiredGb.toFixed(1)} GB`}
                  </Button>
                );
              })()}
              <Button variant="subtle" size="sm" onClick={onInstallRecommended} disabled={installingReco}>
                {`Tất cả ~${reco.download_gb_remaining} GB`}
              </Button>
            </div>
          </div>
          <div className="reco-banner__grid">
            {reco.models.map(m => (
              <span key={m.repo_id} className={`reco-banner__model ${m.installed ? 'reco-banner__model--ok' : ''}`}>
                {m.installed ? '✓' : '○'} {m.label}
                <span className="reco-banner__model-size">{m.size_gb}</span>
                {m.required && <span className="reco-banner__req">req</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="models-controls">
        <Segmented
          size="sm"
          value={currentRole}
          onChange={setActiveRole}
          className="models-roletabs"
          items={[
            {
              value: 'all',
              label: `${t('common.all', 'Tất cả')} ${allInstalled}/${allModels.length}`,
            },
            ...roles.map(r => {
              const installed = groups[r].filter(m => m.installed).length;
              return {
                value: r,
                label: `${MODEL_ROLE_LABEL[r] || r.toUpperCase()} ${installed}/${groups[r].length}`,
              };
            }),
          ]}
        />
        <input
          type="search"
          className="models-search"
          placeholder={t('settings.search_models')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label={t('settings.search_models')}
        />
      </div>

      <Table className="models-table">
        <div className="ui-table-header models-table__header">
          {table.getHeaderGroups().map(headerGroup => (
            <React.Fragment key={headerGroup.id}>
              {headerGroup.headers.map(header => {
                const meta = header.column.columnDef.meta || {};
                const canSort = header.column.getCanSort();
                return (
                  <button
                    key={header.id}
                    type="button"
                    className={[
                      'ui-table-header__cell',
                      `ui-table-header__cell--align-${meta.align || 'left'}`,
                      canSort ? 'models-table__sort' : 'models-table__sort--off',
                    ].join(' ')}
                    style={{ width: header.column.columnDef.size, flex: header.column.id === 'name' ? '1 1 auto' : '0 0 auto' }}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    disabled={!canSort}
                    title={canSort ? `Sắp xếp theo ${String(header.column.columnDef.header || '')}` : undefined}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === 'asc' && <span className="models-table__sortmark">↑</span>}
                    {header.column.getIsSorted() === 'desc' && <span className="models-table__sortmark">↓</span>}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
        <div ref={tableBodyRef} className="models-table__body">
          <div className="models-table__virtual" style={{ height: rowVirtualizer.getTotalSize() }}>
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const row = tableRows[virtualRow.index];
              const m = row.original;
              const rt = getRowRuntime(m);
              return (
                <div
                  key={row.id}
                  className={`models-row ${m.installed ? 'is-ok' : 'is-off'}${rt.unsupported ? ' is-unsupported' : ''}`}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {row.getVisibleCells().map(cell => {
                    const meta = cell.column.columnDef.meta || {};
                    return (
                      <div
                        key={cell.id}
                        className={`models-row__cell ${meta.className || ''}`}
                        style={{
                          width: cell.column.columnDef.size,
                          flex: cell.column.id === 'name' ? '1 1 auto' : '0 0 auto',
                          textAlign: meta.align || undefined,
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {tableRows.length === 0 && (
              <div className="models-table__empty">Không có mô hình nào khớp với bộ lọc của bạn.</div>
            )}
          </div>
        </div>
      </Table>
    </section>
  );
}


export function EnginesTab() {
  const { t } = useTranslation();
  const reviewMode = useAppStore(s => s.reviewMode);
  const setReviewMode = useAppStore(s => s.setReviewMode);

  // Plan 02-04 / ENGINE-06 — việc chọn engine được kết nối thông qua
  // callback onSelect tùy chọn của component matrix, nên matrix cũng đóng vai trò
  // là một bộ chọn (picker). Giữ một nguồn sự thật duy nhất cho danh sách engine +
  // trạng thái cài đặt / GPU / cách ly của nó.
  const onSelect = useCallback(async (family, backendId) => {
    try {
      const r = await selectEngine(family, backendId);
      toast.success(`${family.toUpperCase()} → ${r.active}`);
    } catch (e) {
      toast.error(e.message || 'Không thể chuyển đổi engine');
    }
  }, []);

  return (
    <section className="settings-section settings-section--compact">
      <div className="models-toolbar">
        <div className="models-toolbar__stats">
          <Segmented
            size="xs"
            value={reviewMode}
            onChange={setReviewMode}
            items={[
              { value: 'on',  label: t('settings.review', 'Review') },
              { value: 'off', label: t('settings.rapid_fire', 'Rapid-fire') },
            ]}
          />
          <span className="models-toolbar__sep">·</span>
          <span>
            {reviewMode === 'on' ? 'Bật biểu ngữ giai đoạn' : 'Tắt biểu ngữ giai đoạn'}
          </span>
        </div>
      </div>

      <EngineCompatibilityMatrix family="tts" onSelect={onSelect} />
    </section>
  );
}


const isTauri = () => _isTauri;

// Tauri v2's webview vô hiệu hóa window.confirm/alert gốc — chúng trả về
// false một cách âm thầm, làm cho các nút Xóa/Cài đặt lại trông như bị hỏng. Định tuyến qua
// plugin dialog khi chạy trong Tauri, quay lại trình duyệt confirm
// ở những nơi khác (vite dev, tests).
async function askConfirm(message, title = 'Xác nhận') {
  if (isTauri()) {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return ask(message, { title, kind: 'warning' });
  }
  return Promise.resolve(window.confirm(message));
}

export default function Settings() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('models');
  const [logSource, setLogSource] = useState('backend');
  const [logs, setLogs] = useState([]);
  const [logMeta, setLogMeta] = useState({ path: '', exists: false });
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [appVersion, setAppVersion] = useState(null);
  const [tauriVersion, setTauriVersion] = useState(null);
  const [updateState, setUpdateState] = useState('idle'); // idle|checking|downloading|uptodate|error

  // TanStack Query — cache dùng chung với App.jsx, không yêu cầu trùng lặp
  const { data: hw } = useSysinfo();
  const { data: status } = useModelStatus();
  const { data: info } = useSystemInfo();

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const app = await import('@tauri-apps/api/app');
        setAppVersion(await app.getVersion());
        if (app.getTauriVersion) setTauriVersion(await app.getTauriVersion());
      } catch { /* web preview */ }
    })();
  }, []);

  // sysinfo polling hiện được xử lý bởi hook useSysinfo() ở trên

  const copyDiagnostics = useCallback(async () => {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const ua = nav.userAgent || '—';
    const lang = nav.language || '—';
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return '—'; } })();
    const fmtGB = (v) => (typeof v === 'number' ? `${v.toFixed(2)} GB` : '—');
    const lines = [
      '### OmniVoice Studio diagnostics',
      '',
      `- **Phiên bản App:** ${appVersion || '—'}`,
      `- **Tauri runtime:** ${tauriVersion || (isTauri() ? '—' : 'web preview')}`,
      `- **Nền tảng:** ${info?.platform || '—'}`,
      `- **Kiến trúc:** ${nav.userAgentData?.platform || nav.platform || '—'}`,
      `- **Locale / múi giờ:** ${lang} / ${tz}`,
      `- **Python:** ${info?.python || '—'}`,
      `- **Thiết bị tính toán:** ${info?.device || '—'}`,
      `- **GPU hoạt động:** ${hw?.gpu_active ? 'có' : 'không'}`,
      `- **RAM:** ${fmtGB(hw?.ram)} đã dùng / ${fmtGB(hw?.total_ram)} tổng cộng`,
      `- **VRAM (đã cấp phát):** ${fmtGB(hw?.vram)}`,
      `- **Trạng thái Backend:** ${status?.status || 'không rõ'}`,
      `- **Mô hình hoạt động:** ${status?.repo_id || info?.model_checkpoint || '—'}`,
      `- **Mô hình ASR:** ${info?.asr_model || '—'}`,
      `- **Trình dịch:** ${info?.translate_provider || '—'}`,
      `- **HF token set:** ${info?.has_hf_token ? 'có' : 'không'}`,
      `- **Thư mục dữ liệu:** ${info?.data_dir || '—'}`,
      `- **Thư mục đầu ra:** ${info?.outputs_dir || '—'}`,
      `- **Nhật ký lỗi:** ${info?.crash_log_path || '—'}`,
      `- **Update endpoint:** https://github.com/debpalash/OmniVoice-Studio/releases/latest/download/latest.json`,
      `- **User agent:** ${ua}`,
    ];
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Đã sao chép chẩn đoán — hãy dán vào báo cáo lỗi của bạn.');
    } catch (e) {
      toast.error('Sao chép thất bại: ' + (e?.message || e));
    }
  }, [appVersion, tauriVersion, info, status, hw]);

  const checkForUpdates = useCallback(async () => {
    if (!isTauri()) {
      toast('Trình cập nhật chỉ chạy trong ứng dụng máy tính.', { icon: 'ℹ️' });
      return;
    }
    setUpdateState('checking');
    try {
      const [{ check }, { relaunch }, { ask }] = await Promise.all([
        import('@tauri-apps/plugin-updater'),
        import('@tauri-apps/plugin-process'),
        import('@tauri-apps/plugin-dialog'),
      ]);
      const update = await check();
      if (!update) {
        setUpdateState('uptodate');
        toast.success("Bạn đang sử dụng phiên bản mới nhất.");
        return;
      }
      const proceed = await ask(
        `Phiên bản ${update.version} đã có sẵn.\n\n${update.body || 'Xem ghi chú phát hành trên GitHub.'}\n\nTải xuống và cài đặt ngay?`,
        { title: 'Có bản cập nhật mới', kind: 'info' },
      );
      if (!proceed) { setUpdateState('idle'); return; }
      setUpdateState('downloading');
      const t = toast.loading(`Đang tải xuống ${update.version}…`);
      await update.downloadAndInstall();
      toast.success('Đã cài đặt — đang khởi động lại.', { id: t });
      await relaunch();
    } catch (e) {
      setUpdateState('error');
      toast.error('Kiểm tra cập nhật thất bại: ' + (e?.message || e));
    }
  }, []);

  // refreshInfo polling được thay thế bởi TanStack Query (useSystemInfo + useModelStatus)
  const refreshInfo = useCallback(() => {}, []);

  const refreshLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      if (logSource === 'backend') {
        const r = await systemLogs(400);
        setLogs(r.lines || []);
        setLogMeta({ path: r.path || '', exists: !!r.exists });
      } else if (logSource === 'tauri') {
        const r = await systemLogsTauri(400);
        setLogs(r.lines || []);
        setLogMeta({ path: r.path || '—', exists: !!r.exists, candidates: r.candidates });
      } else {
        const entries = getFrontendLogs();
        const lines = entries.map((e) => {
          const ts = new Date(e.t).toISOString().slice(11, 23);
          return `[${ts}] [${e.level}] ${e.msg}\n`;
        });
        setLogs(lines);
        setLogMeta({ path: 'trong bộ nhớ (500 cái cuối)', exists: true });
      }
    } catch (e) {
      toast.error('Không thể tải nhật ký: ' + e.message);
    } finally {
      setLoadingLogs(false);
    }
  }, [logSource]);

  useEffect(() => {
    if (activeTab === 'logs') refreshLogs();
  }, [activeTab, logSource, refreshLogs]);

  const onClearLogs = async () => {
    if (logSource === 'frontend') {
      if (!(await askConfirm('Xóa bộ đệm nhật ký frontend trong bộ nhớ?', 'Xóa nhật ký'))) return;
      clearFrontendLogs();
      toast.success('Đã xóa nhật ký frontend');
      setLogs([]);
      return;
    }
    if (logSource === 'tauri') {
      if (!(await askConfirm('Cắt bớt các tệp nhật ký phía Tauri? Hệ điều hành sẽ tiếp tục ghi các mục mới.', 'Xóa nhật ký Tauri'))) return;
      try {
        const r = await clearTauriLogs();
        if (!r?.cleared?.length) {
          toast('Không có gì để xóa — chưa có tệp nhật ký Tauri trên đĩa.', { icon: 'ℹ️' });
        } else {
          toast.success(`Đã xóa ${r.cleared.length} tệp nhật ký Tauri`);
          setLogs([]);
        }
      } catch (e) {
        toast.error('Không thể xóa nhật ký Tauri: ' + e.message);
      }
      return;
    }
    if (!(await askConfirm('Xóa nhật ký backend + nhật ký lỗi? Thao tác này không thể hoàn tác.', 'Xóa nhật ký'))) return;
    try {
      await clearSystemLogs();
      toast.success('Đã xóa nhật ký backend');
      setLogs([]);
    } catch (e) {
      toast.error('Không thể xóa nhật ký');
    }
  };

  const modelBadge =
    status?.status === 'ready'   ? <Badge tone="success"><CheckCircle size={11} /> {t('settings.ready')}</Badge>
  : status?.status === 'loading' ? <Badge tone="warn"><RefreshCw size={11} className="spinner" /> {t('settings.loading')}</Badge>
                                 : <Badge tone="warn">{t('settings.idle')}</Badge>;

  return (
    <div className="settings-page">
      <Tabs
        items={TABS(t)}
        value={activeTab}
        onChange={setActiveTab}
        className="settings-tabs-ui"
      />

      {activeTab === 'models' && <ModelStoreTab info={info} modelBadge={modelBadge} />}

      {activeTab === 'engines' && <EnginesTab />}

      {activeTab === 'capture' && <HotkeyTab />}

      {activeTab === 'credentials' && <CredentialsTab info={info} />}

      {activeTab === 'logs' && (
        <section className="settings-section">
          <h2 className="settings-section__head-row">
            <span className="settings-section__head-left">
              <FileText size={16} color="#fabd2f" /> {t('settings.logs')}
            </span>
            <span className="settings-section__head-actions">
              <Button
                variant="subtle"
                size="sm"
                onClick={refreshLogs}
                loading={loadingLogs}
                leading={!loadingLogs && <RefreshCw size={11} />}
              >
                {t('settings.refresh')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={onClearLogs}
                leading={<Trash2 size={11} />}
              >
                {t('common.delete')}
              </Button>
            </span>
          </h2>

          <Segmented
            items={LOG_SOURCES(t)}
            value={logSource}
            onChange={setLogSource}
          />

          <div className="settings-log-meta">
            <span>{logMeta.path || '—'}</span>
            {logSource === 'tauri' && !logMeta.exists && (
              <Badge tone="warn">
                <AlertCircle size={11} /> Chưa có nhật ký Tauri trên đĩa — hãy chạy qua bản build desktop để tạo
              </Badge>
            )}
          </div>
          <div className="settings-log">
            {logs.length === 0
              ? <span className="settings-log__empty">
                  {logSource === 'frontend'
                    ? 'Chưa thu thập được mục console frontend nào. Hãy tương tác với ứng dụng — mọi console.* sẽ xuất hiện ở đây.'
                    : logSource === 'tauri'
                      ? 'Không có nhật ký Tauri. Chỉ chạy trong shell desktop.'
                      : "Nhật ký runtime trống. Hoạt động sẽ xuất hiện ở đây khi backend ghi nhật ký."}
                </span>
              : logs.join('')}
          </div>
        </section>
      )}

      {activeTab === 'about' && (
        <section className="settings-section">
          <h2><Info size={16} color="#8ec07c" /> {t('settings.about')}</h2>
          <Row label="Ứng dụng"         value="OmniVoice Studio" />
          <Row label={t('settings.version')} value={appVersion || '—'} mono />
          <Row label="Tauri runtime"   value={tauriVersion || (isTauri() ? '—' : 'web preview')} mono />
          <Row label={t('settings.platform')} value={info?.platform || '—'} />
          <Row label={t('settings.architecture')} value={typeof navigator !== 'undefined' ? (navigator.userAgentData?.platform || navigator.platform || '—') : '—'} mono />
          <Row label={t('settings.python')} value={info?.python || '—'} mono />
          <Row label={t('settings.device')} value={info?.device || '—'} mono />
          <Row label={t('settings.gpu_active')} value={hw?.gpu_active
            ? <Badge tone="success"><CheckCircle size={11} /> {t('settings.yes')}</Badge>
            : <Badge tone="neutral">{t('settings.no')}</Badge>} />
          <Row label={t('settings.ram')} value={hw ? `${hw.ram?.toFixed(2)} / ${hw.total_ram?.toFixed(2)} GB` : '—'} mono />
          <Row label={t('settings.vram')} value={hw ? `${hw.vram?.toFixed(2)} GB` : '—'} mono />
          <Row label="Backend"         value={<Badge tone={status?.status === 'ready' ? 'success' : status?.status === 'loading' ? 'warn' : 'neutral'}>{status?.status || 'không rõ'}</Badge>} />
          <Row label={t('settings.active_model')} value={status?.repo_id || info?.model_checkpoint || '—'} mono />
          <Row label={t('settings.asr_model')} value={info?.asr_model || '—'} mono />
          <Row label={t('settings.translator')} value={info?.translate_provider || '—'} />
          <Row label={t('settings.hf_token_set')} value={info?.has_hf_token ? t('settings.yes') : t('settings.no')} />
          <Row label={t('settings.data_dir')} value={info?.data_dir || '—'} mono />
          <Row label={t('settings.outputs')} value={info?.outputs_dir || '—'} mono />
          <Row label={t('settings.crash_log')} value={info?.crash_log_path || '—'} mono />
          <Row label={t('settings.update_endpoint')} value="releases/latest/download/latest.json" mono />
          <div className="settings-link-row">
            <Button
              variant="primary"
              size="md"
              leading={<Download size={12} />}
              onClick={checkForUpdates}
              loading={updateState === 'checking' || updateState === 'downloading'}
              disabled={!isTauri()}
            >
              {updateState === 'downloading' ? t('settings.downloading') : t('settings.check_updates')}
            </Button>
            <Button
              variant="subtle"
              size="md"
              leading={<Copy size={12} />}
              onClick={copyDiagnostics}
            >
              {t('settings.copy_diagnostics')}
            </Button>
            <Button
              variant="subtle"
              size="md"
              leading={<ExternalLink size={12} />}
              onClick={() => openExternal('https://github.com/k2-fsa/OmniVoice')}
            >
              OmniVoice trên GitHub
            </Button>
            <Button
              variant="subtle"
              size="md"
              leading={<ExternalLink size={12} />}
              onClick={() => openExternal('https://huggingface.co/k2-fsa/OmniVoice')}
            >
              Model card
            </Button>
            <Button
              variant="subtle"
              size="md"
              leading={<Building2 size={12} />}
              onClick={() => { useAppStore.getState().setMode?.('enterprise'); }}
            >
              {t('menu.enterprise')}
            </Button>
          </div>
        </section>
      )}

      {activeTab === 'privacy' && (
        <section className="settings-section">
          <h2><ShieldCheck size={16} color="#b8bb26" /> {t('settings.privacy')}</h2>
          <p className="settings-prose">
            Mọi thứ đều chạy trên <strong>máy tính này</strong>. Âm thanh, video và bản ghi âm của bạn
            không bao giờ rời khỏi máy tính trừ khi bạn sử dụng một trình dịch trực tuyến một cách rõ ràng (Google, DeepL, v.v.) hoặc
            đẩy lên HuggingFace.
          </p>
          <Row label="Tải lên được lưu tại"   value={info?.data_dir ? `${info.data_dir}/` : '—'} mono />
          <Row label="Đầu ra được lưu tại"   value={info?.outputs_dir || '—'} mono />
          <Row label="Lịch sử tạo"  value={<Badge tone="neutral">SQLite nội bộ</Badge>} />
          <Row
            label="Các cuộc gọi mạng"
            value={
              info?.translate_provider && ['google', 'deepl', 'mymemory', 'microsoft', 'openai'].includes(info.translate_provider)
                ? <Badge tone="warn"><AlertCircle size={11} /> Trình dịch trực tuyến: {info.translate_provider}</Badge>
                : <Badge tone="success"><CheckCircle size={11} /> Trình dịch ngoại tuyến</Badge>
            }
          />
          <Row
            label="Phép đo mô hình"
            value={<Badge tone="success"><CheckCircle size={11} /> Không — không theo dõi</Badge>}
          />
        </section>
      )}
    </div>
  );
}

// ── Tab Hotkey ────────────────────────────────────────────────────────────

function HotkeyTab() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState('');
  const [saving, setSaving] = useState(false);
  const tauri = isTauri();

  // Tải phím tắt đã lưu khi mount.
  useEffect(() => {
    if (!tauri) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const v = await invoke('get_dictation_shortcut');
        setCurrent(v || '');
      } catch (e) {
        toast.error(`Không thể tải phím tắt: ${e?.message || e}`);
      }
    })();
  }, [tauri]);

  // Trong khi ghi âm, chặn các phím nhấn trên toàn cầu và chuyển lần nhấn thực sự
  // tiếp theo thành một chuỗi accelerator. Escape để hủy.
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(false);
        setPending('');
        return;
      }
      const accel = keyEventToAccelerator(e);
      if (accel) {
        setPending(accel);
        setRecording(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording]);

  const save = async () => {
    if (!pending || pending === current) return;
    setSaving(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const saved = await invoke('set_dictation_shortcut', { accelerator: pending });
      setCurrent(saved);
      setPending('');
      toast.success(`Đã đặt phím tắt đọc văn bản thành ${saved}`);
    } catch (e) {
      // Nguyên nhân phổ biến: Hệ điều hành hoặc ứng dụng khác đã sở hữu tổ hợp phím này.
      // Hiển thị lỗi thô để người dùng có thể chọn phím khác.
      toast.error(`Không thể đăng ký: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const resetDefault = async () => {
    setSaving(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const saved = await invoke('set_dictation_shortcut', {
        accelerator: 'CmdOrCtrl+Shift+Space',
      });
      setCurrent(saved);
      setPending('');
      toast.success('Đã đặt lại về mặc định');
    } catch (e) {
      toast.error(`Đặt lại thất bại: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-section">
      <h2><Keyboard size={16} color="#83a598" /> Capture & Đọc văn bản</h2>

      {!tauri && (
        <p className="settings-prose">
          Phím nóng toàn cầu chỉ hoạt động trong ứng dụng máy tính. Giao diện web sử dụng phím tắt
          trong trang <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> khi cửa sổ được tập trung.
        </p>
      )}

      <div className="settings-row">
        <span className="label">Phím tắt đang hoạt động</span>
        <span className="value settings-row__mono">{current || '—'}</span>
      </div>

      <div className="settings-row">
        <span className="label">{recording ? 'Nhấn một tổ hợp phím…' : 'Phím tắt mới'}</span>
        <span className="value settings-row__mono">
          {recording ? '⌨︎ đang nghe (Esc để hủy)' : (pending || '—')}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button
          size="sm"
          variant="subtle"
          onClick={() => { setPending(''); setRecording(true); }}
          disabled={!tauri || saving}
          leading={<Keyboard size={12} />}
        >
          {recording ? 'Đang ghi âm…' : 'Ghi âm phím tắt'}
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={!tauri || !pending || pending === current}
          loading={saving}
        >
          {t('common.save')}
        </Button>
        <Button
          size="sm"
          variant="subtle"
          onClick={resetDefault}
          disabled={!tauri || saving}
        >
          {t('common.reset')} về mặc định
        </Button>
      </div>

      <p className="settings-prose" style={{ marginTop: 12 }}>
        Phím nóng hoạt động trên toàn hệ thống trong khi OmniVoice đang chạy — nó tập trung vào
        cửa sổ và bắt đầu đọc văn bản. Tránh các tổ hợp phím đã được Hệ điều hành xác nhận
        (trên macOS, <code>⌘+Space</code> là Spotlight và <code>⌘+⇧+Space</code>
        chuyển đổi nguồn đầu vào). Nếu đăng ký thất bại, hãy chọn một tổ hợp phím khác.
      </p>
    </section>
  );
}

// ── Tab Thông tin xác thực ───────────────────────────────────────────────────────

const CREDENTIAL_FIELDS = (t) => [
  {
    key: 'HF_TOKEN',
    label: 'HuggingFace Token',
    placeholder: 'hf_xxxxxxxxxxxx',
    help: 'Bắt buộc để phân tách người nói và tải xuống mô hình nhanh hơn. Lấy tại huggingface.co/settings/tokens.',
    link: 'https://huggingface.co/settings/tokens',
  },
  {
    key: 'TRANSLATE_API_KEY',
    label: 'Translation API Key',
    placeholder: 'API key',
    help: 'Tùy chọn — dành cho DeepL, OpenAI hoặc các trình dịch trả phí khác. Không cần thiết cho Google Translate (gói miễn phí).',
    link: null,
  },
];

function CredentialsTab({ info }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(null);
  const [saved, setSaved] = useState({});

  const save = async (key) => {
    const value = (values[key] || '').trim();
    if (!value) return;
    setSaving(key);
    try {
      const { API } = await import('../api/client');
      const res = await fetch(`${API}/system/set-env`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) {
        toast.success(`${key} đã được lưu cho phiên này`);
        setSaved(prev => ({ ...prev, [key]: true }));
        setValues(prev => ({ ...prev, [key]: '' }));
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.detail || 'Không thể lưu');
      }
    } catch (e) {
      toast.error(`Lưu thất bại: ${e.message}`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="settings-section">
      <h2><KeyRound size={16} color="#fe8019" /> {t('settings.credentials')}</h2>

      {/* Wave 2 AUTH-03 panel — Thác 3 nguồn với badge Hoạt động,
          Lưu trữ nguồn App được mã hóa khi nghỉ và trạng thái whoami trực tiếp. */}
      <ApiKeysPanel />

      {/* Wave 2 INST-12 panel — Cách khắc phục Windows torch.compile OOM
          (#65). Nút bật/tắt bị vô hiệu hóa trên macOS/Linux kèm theo
          giải thích; backend bỏ qua cờ này trên các hệ điều hành không phải Windows. */}
      <PerformancePanel />

      {/* Tỉ lệ giao diện + chủ đề màu sắc — được di chuyển ra khỏi LogsFooter chrome để
          footer có thể tập trung vào nhật ký. Các tùy chỉnh hiếm khi dùng thuộc về đây. */}
      <AppearancePanel />

      <p className="settings-prose">
        Các API key và token khác được đặt <strong>chỉ cho phiên này</strong>.
        Để duy trì qua các lần khởi động lại, hãy đặt chúng làm biến môi trường trong
        shell profile của bạn.
      </p>
      {CREDENTIAL_FIELDS(t).filter(f => f.key !== 'HF_TOKEN').map(field => (
        <div key={field.key} className="settings-credential">
          <div className="settings-credential__header">
            <label className="settings-credential__label">{field.label}</label>
            {field.key === 'HF_TOKEN' && (
              <Badge tone={info?.has_hf_token || saved.HF_TOKEN ? 'success' : 'warn'} size="xs">
                {info?.has_hf_token || saved.HF_TOKEN ? `✓ Đã đặt (${t('settings.yes')})` : `✗ Chưa đặt (${t('settings.no')})`}
              </Badge>
            )}
          </div>
          <div className="settings-credential__row">
            <input
              type="password"
              className="settings-credential__input"
              placeholder={field.placeholder}
              value={values[field.key] || ''}
              onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && save(field.key)}
            />
            <Button
              size="sm"
              variant="subtle"
              loading={saving === field.key}
              onClick={() => save(field.key)}
              disabled={!(values[field.key] || '').trim()}
            >
              {t('common.save')}
            </Button>
          </div>
          <p className="settings-credential__help">
            {field.help}
            {field.link && (
              <> <a href="#" onClick={e => { e.preventDefault(); openExternal(field.link); }}>Lấy token →</a></>
            )}
          </p>
        </div>
      ))}
    </section>
  );
}

// Convert a KeyboardEvent into a tauri-plugin-global-shortcut accelerator
// string, e.g. "CmdOrCtrl+Shift+Space". Returns null when only modifiers
// are held (the user hasn't picked a "real" key yet).
function keyEventToAccelerator(e) {
  const isMacLike = typeof navigator !== 'undefined'
    && /Mac|iPad|iPhone|iPod/.test(navigator.platform || '');
  const mods = [];
  if (e.metaKey) mods.push(isMacLike ? 'Cmd' : 'Super');
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  // e.code is the physical key — already in the shape tauri expects for
  // Letter/Digit/Function keys ("KeyA", "Digit1", "F5"). Strip the prefix
  // so we get "A" / "1" / "F5" which matches the accelerator grammar.
  let key = e.code;
  if (!key) return null;
  if (key.startsWith('Key')) key = key.slice(3);
  else if (key.startsWith('Digit')) key = key.slice(5);
  // Skip pure modifier keys — we want the user to pick a real trigger.
  if (/^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/.test(key)) return null;

  if (mods.length === 0) return null;
  return [...mods, key].join('+');
}
