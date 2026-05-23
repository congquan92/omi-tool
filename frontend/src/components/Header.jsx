import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Globe, Fingerprint, Wand2, Film, FolderOpen, RefreshCw, Settings2, ChevronRight, ChevronDown, Zap, Building2, Library, FileText, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Badge } from '../ui';
import NotificationPanel from './NotificationPanel';
import { useAppStore } from '../store';

function WaveBars({ color = '#f3a5b6', active }) {
  const heights = [4, 9, 5, 11, 6, 10, 5, 8];
  return (
    <div className={`hq-wave ${active ? 'is-active' : ''}`} aria-hidden="true">
      {heights.map((h, i) => (
        <span
          key={i}
          className={active ? 'hq-wave-bar active' : 'hq-wave-bar'}
          style={{
            // Chiều cao và màu sắc theo từng instance; animation-delay theo từng thanh.
            // Ba thuộc tính này thực sự động nên để inline.
            height: h,
            background: color,
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function Header({
  mode, setMode, sysStats, modelStatus, doubleClickMaximize,
  activeProjectName, onFlushMemory,
}) {
  const { t } = useTranslation();

  const VIEW_META = {
    launchpad:  { label: t('menu.launchpad'),       Icon: Globe,       accent: '#f3a5b6', kicker: t('menu.kicker_studio') },
    clone:      { label: t('menu.clone'),           Icon: Fingerprint, accent: '#d3869b', kicker: t('menu.kicker_studio') },
    design:     { label: t('menu.design'),          Icon: Wand2,       accent: '#8ec07c', kicker: t('menu.kicker_studio') },
    dub:        { label: t('menu.dub'),             Icon: Film,        accent: '#fe8019', kicker: t('menu.kicker_studio') },
    projects:   { label: t('menu.projects'),        Icon: FolderOpen,  accent: '#83a598', kicker: t('menu.kicker_library') },
    gallery:    { label: t('menu.gallery'),         Icon: Library,     accent: '#b8bb26', kicker: t('menu.kicker_library') },
    transcriptions: { label: t('menu.transcriptions'), Icon: FileText, accent: '#d3869b', kicker: t('menu.kicker_library') },
    settings:   { label: t('menu.settings'),        Icon: Settings2,   accent: '#fabd2f', kicker: t('menu.kicker_preferences') },
    enterprise: { label: t('menu.enterprise'),      Icon: Building2,   accent: '#fe8019', kicker: t('menu.kicker_licensing') },
  };

  // Mặc định TẮT — chrome không nên đóng vai trò là trình theo dõi tài nguyên.
  // Người dùng nâng cao có thể bật tính năng này qua Cài đặt → Hiệu năng.
  // Badge Trạng thái Nghỉ/Sẵn sàng/Đang tải + nút Flush vẫn hiển thị bất kể điều gì (liên quan đến hành động).
  const showLiveStats = useAppStore(s => s.showHeaderLiveStats);
  const [flushing, setFlushing] = useState(false);
  const [flushOpen, setFlushOpen] = useState(false);
  const [loadedModels, setLoadedModels] = useState([]);
  const [unloading, setUnloading] = useState(null);
  const flushRef = useRef(null);
  const flushBtnRef = useRef(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  // Tính toán động vị trí dropdown từ rect của button
  const computePos = useCallback(() => {
    if (!flushBtnRef.current) return;
    const rect = flushBtnRef.current.getBoundingClientRect();
    const dropW = 260;
    const dropH = 220; // chiều cao tối đa ước tính
    const pad = 6;

    // Mặc định: bên dưới button, căn phải
    let top = rect.bottom + pad;
    let left = rect.right - dropW;

    // Lật lên nếu quá gần cạnh dưới
    if (top + dropH > window.innerHeight - 10) {
      top = rect.top - dropH - pad;
    }
    // Giới hạn left để không tràn khỏi màn hình
    if (left < 8) left = 8;
    if (left + dropW > window.innerWidth - 8) left = window.innerWidth - dropW - 8;

    setDropdownPos({ top, left });
  }, []);

  // Tính toán lại khi mở, thay đổi kích thước và cuộn
  useEffect(() => {
    if (!flushOpen) return;
    computePos();
    window.addEventListener('resize', computePos);
    window.addEventListener('scroll', computePos, true);
    return () => {
      window.removeEventListener('resize', computePos);
      window.removeEventListener('scroll', computePos, true);
    };
  }, [flushOpen, computePos]);
  const view = VIEW_META[mode] || VIEW_META.launchpad;
  const ViewIcon = view.Icon;

  // Lấy các mô hình đã tải khi dropdown mở
  useEffect(() => {
    if (!flushOpen) return;
    const fetchModels = async () => {
      try {
        const { API } = await import('../api/client');
        const res = await fetch(`${API}/model/loaded`);
        if (res.ok) {
          const data = await res.json();
          setLoadedModels(data.models || []);
        }
      } catch {}
    };
    fetchModels();
  }, [flushOpen]);

  // Click ra ngoài để đóng (phải kiểm tra cả button wrapper VÀ portal dropdown)
  const dropdownRef = useRef(null);
  useEffect(() => {
    if (!flushOpen) return;
    const handler = (e) => {
      const inBtn = flushRef.current && flushRef.current.contains(e.target);
      const inDrop = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inBtn && !inDrop) setFlushOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [flushOpen]);

  const unloadModel = async (modelId) => {
    setUnloading(modelId);
    try {
      const { API } = await import('../api/client');
      const res = await fetch(`${API}/model/unload/${modelId}`, { method: 'POST' });
      if (res.ok) {
        setLoadedModels(prev => prev.filter(m => m.id !== modelId));
      }
    } catch {} finally {
      setUnloading(null);
    }
  };
  // Màu sắc accent động phải để inline — nó được điều khiển bởi view hiện tại.
  const dotStyle   = { background: view.accent, boxShadow: `0 0 10px ${view.accent}90` };
  const labelStyle = { color: view.accent };
  return (
    <div
      className="header-area"
      data-tauri-drag-region
      onDoubleClick={doubleClickMaximize}
    >
      {/* Trái: tiêu đề view + breadcrumb */}
      <div className="hq-col-left">
        <div className="hq-col-left__spacer" />
        <div className="hq-view-title">
          <span className="hq-view-dot" style={dotStyle} />
          <span className="hq-view-kicker">{view.kicker}</span>
          <ChevronRight size={10} color="#504945" className="hq-breadcrumb-sep" />
          <span className="hq-view-label" style={labelStyle}>
            <ViewIcon size={12} className="hq-view-icon" />
            {view.label}
          </span>
          {activeProjectName ? (
            <>
              <ChevronRight size={10} color="#504945" className="hq-breadcrumb-sep" />
              <span className="hq-view-project" title={activeProjectName}>{activeProjectName}</span>
            </>
          ) : null}
        </div>
        {import.meta.env.DEV && (
          <Button
            variant="ghost"
            size="sm"
            title={t('header.reload_ui')}
            onClick={() => window.location.reload()}
            leading={<RefreshCw size={9} />}
            className="hq-reload-btn"
          >
            {t('header.reload')}
          </Button>
        )}
      </div>

      {/* Giữa: logo */}
      <div className="hq-col-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f3a5b6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="hq-logo-mark">
          <circle cx="12" cy="12" r="10" opacity="0.18" fill="#f3a5b6" />
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v12" />
          <path d="M8 9v6" />
          <path d="M16 9v6" />
        </svg>
        <span className="hq-logo-word">
          Omni<span className="hq-logo-word__accent">Voice</span>
        </span>
      </div>

      {/* Phải: wave + sys stats. Tỉ lệ UI (S/M/L) nằm trong thanh
          LogsFooter phía dưới để tất cả các thành phần app-wide chrome ở cùng nhau. */}
      <div className="hq-col-right">
        <NotificationPanel onNavigate={setMode} />
        <WaveBars color={view.accent} active={modelStatus === 'ready' || modelStatus === 'loading'} />
        {sysStats && (
          <div className="hq-stats">
            {showLiveStats && (
              <>
                <span><b className="hq-stats__key">RAM</b> {sysStats.ram.toFixed(1)}/{sysStats.total_ram.toFixed(0)}G</span>
                <span><b className="hq-stats__key">CPU</b> {sysStats.cpu.toFixed(0)}%</span>
                <span className="hq-stats__sep" aria-label={`VRAM usage: ${sysStats.vram.toFixed(1)} gigabytes`}>
                  <b className={`hq-stats__key ${sysStats.gpu_active ? 'hq-stats__key--gpu-active' : ''}`}>VRAM</b> {sysStats.vram.toFixed(1)}G
                </span>
              </>
            )}
            <span className="hq-stats__status-wrap">
              <Badge
                tone={modelStatus === 'ready' ? 'success' : modelStatus === 'loading' ? 'warn' : 'neutral'}
                size="xs"
                dot
                className={`hq-stats__status-badge ${modelStatus === 'loading' ? 'ui-badge--pulse' : ''}`}
              >
                {modelStatus === 'ready' ? t('header.status_ready') : modelStatus === 'loading' ? t('common.loading') : t('header.status_idle')}
              </Badge>
            </span>
            {onFlushMemory && (
              <div ref={flushRef} style={{ position: 'relative' }}>
                <Button
                  ref={flushBtnRef}
                  variant="subtle"
                  size="sm"
                  title={t('header.memory_management')}
                  loading={flushing}
                  leading={!flushing && <Zap size={8} />}
                  trailing={<ChevronDown size={8} />}
                  onClick={() => setFlushOpen(o => !o)}
                  className="hq-flush-btn"
                >
                  {t('header.flush')}
                </Button>
                {flushOpen && createPortal(
                  <div
                    className="hq-flush-dropdown"
                    style={{ top: dropdownPos.top, left: dropdownPos.left }}
                    ref={dropdownRef}
                  >
                    <div className="hq-flush-dropdown__header">{t('header.loaded_models')}</div>
                    {loadedModels.length === 0 ? (
                      <div className="hq-flush-dropdown__empty">{t('header.no_models_loaded')}</div>
                    ) : (
                      loadedModels.map(m => (
                        <div key={m.id} className="hq-flush-dropdown__item">
                          <div className="hq-flush-dropdown__info">
                            <span className="hq-flush-dropdown__name">{m.name}</span>
                            <span className="hq-flush-dropdown__meta">
                              {m.device} {m.vram_mb > 0 ? `· ${m.vram_mb.toFixed(0)} MB` : ''}
                            </span>
                          </div>
                          {m.unloadable && (
                            <button
                              className="hq-flush-dropdown__unload"
                              onClick={() => unloadModel(m.id)}
                              disabled={unloading === m.id}
                              aria-label={`Unload ${m.name}`}
                            >
                              {unloading === m.id ? '…' : t('header.unload')}
                            </button>
                          )}
                        </div>
                      ))
                    )}
                    <div className="hq-flush-dropdown__divider" />
                    <button
                      className="hq-flush-dropdown__action"
                      onClick={async () => {
                        setFlushing(true);
                        setFlushOpen(false);
                        try { await onFlushMemory(false); } finally { setFlushing(false); }
                      }}
                    >
                      <Zap size={10} /> {t('header.flush_caches')}
                    </button>
                    <button
                      className="hq-flush-dropdown__action hq-flush-dropdown__action--danger"
                      onClick={async () => {
                        setFlushing(true);
                        setFlushOpen(false);
                        try { await onFlushMemory(true); } finally { setFlushing(false); }
                      }}
                    >
                      <Trash2 size={10} /> {t('header.unload_all_flush')}
                    </button>
                  </div>,
                  document.body
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
