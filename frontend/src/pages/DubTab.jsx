import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import {
  PanelLeftOpen, PanelLeftClose, Film, Save, UploadCloud, Sparkles, Loader, Square,
  FileText, Play, DownloadIcon, Volume2, Link2,
  Languages, ChevronDown, ChevronUp, Wand2, Trash2, Check, Globe, UserSquare2, User, AlertCircle,
} from 'lucide-react';
// lucide-react xuất DownloadIcon dưới dạng "Download"; alias ở đây để khớp với cách đặt tên trong App.jsx.
import { Download as Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SearchableSelect from '../components/SearchableSelect';
import WaveformTimeline from '../components/WaveformTimeline';
import CheckpointBanner from '../components/CheckpointBanner';
import { useAppStore } from '../store';
import ALL_LANGUAGES from '../languages.json';
import { POPULAR_LANGS, POPULAR_ISO, PRESETS } from '../utils/constants';
import { LANG_CODES } from '../utils/languages';
import { formatTime } from '../utils/format';
import { API } from '../api/client';
import { listTranslationEngines, installTranslationEngine } from '../api/engines';
import toast from 'react-hot-toast';
import { Button, Segmented, Badge, Progress } from '../ui';
import GlossaryPanel from '../components/GlossaryPanel';
import ExportModal from '../components/ExportModal';
import MultiLangPicker from '../components/MultiLangPicker';
import './DubTab.css';

const DubSegmentTable = lazy(() => import('../components/DubSegmentTable'));

const LazyFallback = () => (
  <div className="dub-lazy-fallback">Đang tải…</div>
);

export default function DubTab(props) {
  const { t } = useTranslation();
  const {
    // Props vẫn được truyền qua: state không thể tuần tự hóa + các handler
    // đóng gói scope của App.jsx (upload, SSE wiring, project CRUD, v.v.).
    dubVideoFile, dubLocalBlobUrl,
    transcribeElapsed, translateProvider, setTranslateProvider,
    showTranscript, setShowTranscript,
    onGlossaryChange,
    profiles,
    segmentPreviewLoading,
    selectedSegIds,
    setDubVideoFile, setDubLocalBlobUrl,
    handleDubAbort, handleDubUpload, handleDubIngestUrl, handleDubRetryTranscribe, handleDubStop, handleDubGenerate, handleDubImportSrt,
    handleDubDownload, handleDubAudioDownload, handleAudioExport,
    speakerClones = {},
    handleSegmentPreview, onDirectSegment, handleTranslateAll, handleCleanupSegments,
    incrementalPlan,
    triggerDownload, fileToMediaUrl,
    editSegments, saveProject, resetDub,
    segmentEditField, segmentDelete, segmentRestoreOriginal, segmentSplit, segmentMerge,
    toggleSegSelect, selectAllSegs, clearSegSelection,
    bulkApplyToSelected, bulkDeleteSelected,
  } = props;

  // ── Đọc từ Store (Phase 2.2) — bỏ bớt ~30 props từ App.jsx.
  const dubJobId          = useAppStore(s => s.dubJobId);
  const dubStep           = useAppStore(s => s.dubStep);
  const setDubStep        = useAppStore(s => s.setDubStep);
  const dubPrepStage      = useAppStore(s => s.dubPrepStage);
  const dubFilename       = useAppStore(s => s.dubFilename);
  const dubDuration       = useAppStore(s => s.dubDuration);
  const dubSegments       = useAppStore(s => s.dubSegments);
  const setDubSegments    = useAppStore(s => s.setDubSegments);
  const dubTranscript     = useAppStore(s => s.dubTranscript);
  const dubLang           = useAppStore(s => s.dubLang);
  const setDubLang        = useAppStore(s => s.setDubLang);
  const dubLangCode       = useAppStore(s => s.dubLangCode);
  const setDubLangCode    = useAppStore(s => s.setDubLangCode);
  const dubInstruct       = useAppStore(s => s.dubInstruct);
  const setDubInstruct    = useAppStore(s => s.setDubInstruct);
  const dubTracks         = useAppStore(s => s.dubTracks);
  const dubError          = useAppStore(s => s.dubError);
  const dubProgress       = useAppStore(s => s.dubProgress);
  const isTranslating     = useAppStore(s => s.isTranslating);
  const preserveBg        = useAppStore(s => s.preserveBg);
  const setPreserveBg     = useAppStore(s => s.setPreserveBg);
  const defaultTrack      = useAppStore(s => s.defaultTrack);
  const setDefaultTrack   = useAppStore(s => s.setDefaultTrack);
  const exportTracks      = useAppStore(s => s.exportTracks);
  const setExportTracks   = useAppStore(s => s.setExportTracks);
  const activeProjectName = useAppStore(s => s.activeProjectName);
  const isSidebarCollapsed = useAppStore(s => s.isSidebarCollapsed);
  const setIsSidebarCollapsed = useAppStore(s => s.setIsSidebarCollapsed);
  const translateQuality    = useAppStore(s => s.translateQuality);
  const setTranslateQuality = useAppStore(s => s.setTranslateQuality);
  const dualSubs            = useAppStore(s => s.dualSubs);
  const setDualSubs         = useAppStore(s => s.setDualSubs);
  const burnSubs            = useAppStore(s => s.burnSubs);
  const setBurnSubs         = useAppStore(s => s.setBurnSubs);

  const showIdleSkeleton = !(dubJobId && (dubStep === 'editing' || dubStep === 'generating' || dubStep === 'done'));
  // Handle bắt buộc cho waveform sau khi job xong để bảng transcript có thể
  // seek trình phát khi người dùng click vào một hàng.
  const waveformRef = useRef(null);
  const seekWaveform = useCallback((time) => {
    waveformRef.current?.seekTo?.(time);
  }, []);
  const [ingestUrl, setIngestUrl] = useState('');
  const [previewMode, setPreviewMode] = useState('original'); // 'original' | 'dubbed'
  const [exportOpen, setExportOpen] = useState(false);

  // Chế độ đa ngôn ngữ
  const [multiLangMode, setMultiLangMode] = useState(false);
  const [multiLangs, setMultiLangs] = useState([]);

  // ETA trực tiếp khi đang tạo — đếm từng giây; thời gian còn lại được
  // ngoại suy từ tốc độ hiện tại/tổng số nên nó chỉ có ý nghĩa sau khi
  // ít nhất một phân đoạn đã được render và ~2s đồng hồ đã trôi qua.
  const [genElapsed, setGenElapsed] = useState(0);
  useEffect(() => {
    if (dubStep !== 'generating') { setGenElapsed(0); return; }
    const start = Date.now();
    setGenElapsed(0);
    const id = setInterval(() => setGenElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [dubStep]);
  const genRemaining = (() => {
    if (dubStep !== 'generating') return null;
    if (!dubProgress.total || !dubProgress.current || genElapsed < 2) return null;
    const perSeg = genElapsed / dubProgress.current;
    return Math.max(0, Math.round(perSeg * (dubProgress.total - dubProgress.current)));
  })();

  // Khả dụng của công cụ dịch → điều khiển trạng thái disabled của dropdown Engine
  // và chip Install nội dòng. Được fetch lười một lần; làm mới sau mỗi lần
  // cài đặt/gỡ bỏ để chip biến mất khi thành công.
  const [engines, setEngines] = useState([]);
  const [enginesSandboxed, setEnginesSandboxed] = useState(false);
  const [engineInstalling, setEngineInstalling] = useState(null); // id engine đang cài đặt
  const refreshEngines = useCallback(async () => {
    try {
      const res = await listTranslationEngines();
      setEngines(res.engines || []);
      setEnginesSandboxed(!!res.sandboxed);
    } catch {
      setEngines([]);
    }
  }, []);
  useEffect(() => { refreshEngines(); }, [refreshEngines]);
  const activeEngineEntry = engines.find(e => e.id === translateProvider);
  const activeEngineUnavailable = activeEngineEntry && !activeEngineEntry.installed;
  const handleInstallEngine = async (engineId) => {
    if (!engineId || enginesSandboxed) return;
    setEngineInstalling(engineId);
    const progressToast = toast.loading(`${t('common.loading')} ${engineId}…`);
    try {
      const res = await installTranslationEngine(engineId);
      await refreshEngines();
      if (res.restart_required) {
        toast(`${engineId} đã cài đặt. Khởi động lại backend để tải.`, { icon: '🔄', id: progressToast, duration: 7000 });
      } else if (res.status === 'already_installed') {
        toast(`${engineId} đã được cài đặt trước đó`, { icon: 'ℹ️', id: progressToast });
      } else {
        toast.success(`${engineId} đã cài đặt`, { id: progressToast });
      }
    } catch (err) {
      toast.error(`Cài đặt thất bại: ${String(err.message || err).slice(0, 200)}`, { id: progressToast, duration: 8000 });
    } finally {
      setEngineInstalling(null);
    }
  };

  // Thu gọn các cài đặt phụ (Language/ISO/Style/Engine/Quality) vào một accordion.
  // Khi người dùng đã dịch, công việc của hàng này đã xong; hiển thị tóm tắt
  // một dòng thay vì lưới 5 cột đầy đủ.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasAnyTranslation = dubSegments.some(s => s.text_original && s.text_original !== s.text);

  // Thuật ngữ (Glossary): ẩn sau một chip khi trống, tự động mở khi có thuật ngữ.
  const glossaryTermCount = useAppStore(s => s.glossaryTerms.length);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const glossaryVisible = glossaryOpen || glossaryTermCount > 0;

  // Phase 4.3 — banner checkpoint giữa các giai đoạn.
  const reviewMode = useAppStore(s => s.reviewMode);
  const [dismissedStages, setDismissedStages] = useState(() => new Set());
  const hasTranslations = dubSegments.some(s => s.text_original && s.text_original !== s.text);
  const checkpointStage =
    dubStep === 'editing' && !hasTranslations ? 'asr'
    : dubStep === 'editing' && hasTranslations ? 'translate'
    : dubStep === 'done' ? 'done'
    : null;
  const showCheckpoint = reviewMode === 'on' && checkpointStage && !dismissedStages.has(checkpointStage);
  const onCheckpointContinue = () => {
    if (checkpointStage === 'asr') handleTranslateAll?.();
    else if (checkpointStage === 'translate') handleDubGenerate?.();
  };
  const onCheckpointDismiss = () => {
    setDismissedStages(prev => {
      const next = new Set(prev);
      if (checkpointStage) next.add(checkpointStage);
      return next;
    });
  };
  // Giữ ý định "lấy phụ đề YouTube" qua các lần ingest — đây là tùy chọn mỗi URL
  // nhưng hầu như luôn được bật khi người dùng khám phá ra. Được lưu trên
  // component thay vì store toàn cục để tránh làm bẩn cấu hình đa dự án.
  const [fetchYtSubs, setFetchYtSubs] = useState(false);
  const onIngestUrl = () => {
    if (!ingestUrl.trim() || !handleDubIngestUrl) return;
    handleDubIngestUrl(ingestUrl.trim(), {
      fetchSubs: fetchYtSubs,
      // Mặc định cho "tất cả" các track có sẵn — trình tự động dịch của YouTube
      // làm cho mọi ngôn ngữ chính đều có sẵn theo yêu cầu, vì vậy việc để
      // yt-dlp lấy tất cả chúng ngay từ đầu có nghĩa là việc thay đổi ngôn ngữ
      // mục tiêu sau này không cần thêm một round trip nữa.
      subLangs: fetchYtSubs ? undefined : undefined,
    });
    setIngestUrl('');
  };
  const hasDubbedTrack = dubStep === 'done' && dubLangCode && dubLangCode !== 'und' && (dubTracks?.length > 0 || !!dubTracks);
  const videoSrc = (previewMode === 'dubbed' && hasDubbedTrack)
    ? `${API}/dub/preview-video/${dubJobId}?lang=${encodeURIComponent(dubLangCode)}&preserve_bg=${preserveBg ? 1 : 0}`
    : `${API}/dub/media/${dubJobId}`;

  return (
    <div className="dub-col">
      {/* ── Idle: hiển thị skeleton biên tập đầy đủ với vùng thả tệp ── */}
      {showIdleSkeleton && (
        <div className="dub-col">
          {/* Thanh Header */}
          <div className="dub-head">
            <div className="label-row dub-head__title">
              <Button
                variant="icon"
                iconSize="sm"
                active={isSidebarCollapsed}
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                title={t('menu.sidebar_toggle', 'Bật/Tắt Sidebar')}
              >
                {isSidebarCollapsed ? <PanelLeftOpen size={12} /> : <PanelLeftClose size={12} />}
              </Button>
              <Film className="label-icon" size={11} />
              <span className="dub-head__filename">{dubVideoFile ? dubVideoFile.name : t('dub.title')}</span>
              {dubVideoFile && <span className="dub-head__meta">· {(dubVideoFile.size / 1024 / 1024).toFixed(1)} MB</span>}
              {activeProjectName && activeProjectName !== dubFilename && (
                <span className="dub-head__project">— {activeProjectName}</span>
              )}
            </div>
            <div className="dub-head__actions">
              <Button variant="subtle" size="sm" disabled leading={<Save size={9} />}>{t('common.save')}</Button>
              <Button variant="ghost"  size="sm" disabled>{t('common.reset')}</Button>
            </div>
          </div>

          {/* Banner lỗi transcription — hiển thị ở trạng thái idle khi có job
              nhưng transcription tạo ra không phân đoạn nào (hoặc ném lỗi).
              Hiển thị chi tiết lỗi backend và cung cấp tính năng thử lại bằng một cú nhấp,
              giúp chạy lại luồng ASR trên cùng một job mà không cần upload lại. */}
          {dubError && dubJobId && dubStep === 'idle' && (
            <div className="dub-footer-banner">
              <Badge tone="danger">
                <AlertCircle size={11} /> {dubError}
              </Badge>
              {handleDubRetryTranscribe && (
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={handleDubRetryTranscribe}
                  leading={<Sparkles size={10} />}
                >
                  {t('dub.retry_transcription')}
                </Button>
              )}
              {handleDubImportSrt && (
                <label
                  htmlFor="srt-import-banner-input"
                  className="dub-idle-upload-label"
                  title={t('dub.srt_import_hint')}
                  style={{ cursor: 'pointer' }}
                >
                  <FileText size={11} /> {t('dub.import_srt_instead')}
                  <input
                    id="srt-import-banner-input"
                    type="file"
                    accept=".srt,text/srt,text/plain"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleDubImportSrt(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {/* SPLIT LAYOUT skeleton */}
          <div className={`dub-split-grid ${dubVideoFile ? 'dub-split-2' : 'dub-split-1'}`}>
            {/* TRÁI */}
            <div className="studio-panel dub-panel-col">
              {dubVideoFile ? (
                <>
                  <WaveformTimeline
                    audioSrc={dubLocalBlobUrl?.audioUrl}
                    videoSrc={dubLocalBlobUrl?.videoUrl}
                    segments={[]}
                    onSegmentsChange={() => { }}
                    disabled={true}
                    overlayContent={
                      dubStep === 'uploading' ? (
                        <PrepOverlay stage={dubPrepStage} onAbort={handleDubAbort} />
                      ) : dubStep === 'transcribing' ? (
                        <TranscribeOverlay
                          elapsed={transcribeElapsed}
                          duration={dubDuration}
                          onAbort={handleDubAbort}
                        />
                      ) : null
                    }
                  />
                  <div className="dub-change-row">
                    <label htmlFor="video-upload" className="dub-idle-upload-label">
                      <Film size={13} /> {t('dub.change_file')}
                    </label>
                    {dubJobId && handleDubImportSrt && (
                      <label
                        htmlFor="srt-import-input"
                        className="dub-idle-upload-label"
                        title={t('dub.srt_import_hint')}
                        style={{ cursor: 'pointer' }}
                      >
                        <FileText size={13} /> {t('dub.import_srt')}
                        <input
                          id="srt-import-input"
                          type="file"
                          accept=".srt,text/srt,text/plain"
                          hidden
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDubImportSrt(f);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                    <button className="btn-primary dub-change-row__cta"
                      onClick={handleDubUpload}
                      disabled={dubStep === 'uploading' || dubStep === 'transcribing'}>
                      {dubStep === 'uploading' || dubStep === 'transcribing'
                        ? <><Loader className="spinner" size={14} /> {t('dub.processing')}</>
                        : <><Sparkles size={14} /> {t('dub.upload_transcribe')}</>}
                    </button>
                  </div>
                </>
              ) : dubStep === 'uploading' ? (
                <PrepOverlay stage={dubPrepStage} onAbort={handleDubAbort} large />
              ) : (
                <label htmlFor="video-upload" className="dub-idle-drop"
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('is-dragging'); }}
                  onDragLeave={e => { e.currentTarget.classList.remove('is-dragging'); }}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('is-dragging');
                    const file = e.dataTransfer.files[0];
                    if (file && (file.type.startsWith('video/') || file.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|ogg)$/i.test(file.name))) {
                      setDubVideoFile(file);
                      setDubStep('idle');
                      fileToMediaUrl(file, null).then(urls => setDubLocalBlobUrl(urls));
                    }
                  }}>
                  <div className="dub-idle-drop__puck">
                    <UploadCloud color="#d3869b" size={28} />
                  </div>
                  <div className="dub-idle-drop__lines">
                    <div className="dub-idle-drop__title">{t('dub.drop_hint')}</div>
                    <div className="dub-idle-drop__sub">{t('dub.drop_sub')}</div>
                  </div>
                  <div
                    className="dub-ingest-row"
                    onClick={e => e.preventDefault()}
                  >
                    <Link2 size={13} color="#a89984" />
                    <input
                      type="text"
                      placeholder={t('dub.url_placeholder')}
                      value={ingestUrl}
                      onChange={e => setIngestUrl(e.target.value)}
                      onClick={e => { e.preventDefault(); e.stopPropagation(); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onIngestUrl(); } }}
                      className="dub-ingest-row__input"
                    />
                    <button
                      type="button"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); onIngestUrl(); }}
                      disabled={!ingestUrl.trim()}
                      className={`dub-ingest-row__cta ${ingestUrl.trim() ? 'is-ready' : ''}`}
                    >
                      {t('dub.ingest')}
                    </button>
                  </div>
                  <label
                    className="dub-ingest-sub-opt"
                    title={t('dub.pull_subs_hint', 'Khi URL là máy chủ có phụ đề (YouTube, Vimeo, TED…), cũng lấy phụ đề gốc và mọi bản dịch tự động của YouTube. Dùng để nạp trình biên tập mà không cần chạy Whisper; bỏ qua Dịch tất cả cho các ngôn ngữ mà YouTube đã hỗ trợ.')}
                    onClick={e => { e.stopPropagation(); }}
                  >
                    <input
                      type="checkbox"
                      checked={fetchYtSubs}
                      onChange={e => setFetchYtSubs(e.target.checked)}
                      onClick={e => e.stopPropagation()}
                    />
                    <span>{t('dub.pull_subs')}</span>
                  </label>
                </label>
              )}

              <input type="file" accept="video/*,audio/*,.mp3,.wav,.m4a,.flac,.ogg" id="video-upload" className="dub-hidden-file"
                onChange={e => {
                  const file = e.target.files[0];
                  if (!file) return;
                  setDubVideoFile(file);
                  setDubStep('idle');
                  setDubLocalBlobUrl(prev => { fileToMediaUrl(file, prev).then(urls => setDubLocalBlobUrl(urls)); return prev; });
                }} />

              <div className="dub-cast dub-cast--muted">
                <div className="dub-cast__row">
                  <span className="dub-cast__kicker">{t('dub.cast')}</span>
                  <span className="dub-cast__label">{t('dub.speaker')} 1:</span>
                  <span className="dub-cast--muted__chip">{t('dub.default')}</span>
                </div>
              </div>
            </div>

            {/* PHẢI: Ghost settings + bảng phân đoạn (chỉ khi video đã tải) */}
            {dubVideoFile ? (
            <div className="studio-panel dub-panel-col">
              <div className="dub-skel-settings">
                <div className="dub-skel-field">
                  <div className="label-row"><Globe className="label-icon" size={9} /> {t('voice.language')}</div>
                  <select className="input-base input-base--xs" disabled>
                    <option>{t('dub.auto', 'Tự động')}</option>
                  </select>
                </div>
                <div className="dub-skel-field--sm">
                  <div className="label-row">{t('dub.iso_code')}</div>
                  <select className="input-base input-base--xs" disabled>
                    <option>en — English</option>
                  </select>
                </div>
                <div className="dub-skel-field">
                  <div className="label-row"><UserSquare2 className="label-icon" size={9} /> {t('dub.style')}</div>
                  <input className="input-base input-base--xs" disabled placeholder={t('dub.style_placeholder')} />
                </div>
                <button disabled className="dub-skel-translate-btn">
                  <Languages size={10} /> {t('dub.translate_all')}
                </button>
              </div>
              <div className="dub-skel-transcript-toggle">
                <div className="override-toggle dub-skel-transcript-toggle__inner">
                  <span><FileText size={10} className="dub-inline-icon" /> {t('dub.transcript')}</span>
                  <ChevronDown size={10} />
                </div>
              </div>
              <div className="segment-table dub-skel-table">
                <div className="segment-header">
                  <span className="dub-skel-header-time">{t('dub.time')}</span>
                  <span className="dub-skel-header-spkr">{t('dub.spkr')}</span>
                  <span className="dub-skel-header-text">{t('dub.text')}</span>
                  <span className="dub-skel-header-voice">{t('dub.voice')}</span>
                  <span className="dub-skel-header-acts"></span>
                </div>
                {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                  <div key={i} className="segment-row" style={{ opacity: 0.15 + (0.04 * (8 - i)) }}>
                    <span className="segment-time dub-skel-cell-time">0:00.0–0:00.0</span>
                    <span className="dub-skel-cell-spkr">{t('dub.speaker')} 1</span>
                    <div className="dub-skel-cell-text" />
                    <span className="dub-skel-cell-voice">{t('dub.default')}</span>
                    <div className="dub-skel-cell-acts">
                      <span className="segment-del dub-skel-cell-acts__icon"><Trash2 size={9} /></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            ) : null}
          </div>

          {/* Ghost footer */}
          <div className="studio-panel dub-ghost-footer">
            <div className="dub-skel-gen-row">
              <button className="btn-primary dub-skel-gen-btn" disabled>
                <Play size={11} /> {t('dub.generate_dub')}
              </button>
              <button className="btn-primary dub-skel-gen-btn" disabled>
                <Download size={11} /> MP4
              </button>
              <button className="btn-primary dub-skel-gen-btn" disabled>
                <Volume2 size={11} /> WAV
              </button>
              <button className="btn-primary dub-skel-gen-btn" disabled>
                <FileText size={11} /> SRT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sau khi transcription: trình biên tập song song ── */}
      {dubJobId && (dubStep === 'editing' || dubStep === 'generating' || dubStep === 'done') && (
        <div className="dub-col">
          <div className="dub-head">
            <div className="label-row dub-head__title">
              <Button
                variant="icon"
                iconSize="sm"
                active={isSidebarCollapsed}
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                title={t('menu.sidebar_toggle', 'Bật/Tắt Sidebar')}
              >
                {isSidebarCollapsed ? <PanelLeftOpen size={12} /> : <PanelLeftClose size={12} />}
              </Button>
              <FileText className="label-icon" size={11} />
              <span className="dub-head__filename">{dubFilename}</span>
              <span className="dub-head__meta">· {formatTime(dubDuration)} · {dubSegments.length} {t('dub.segments')}</span>
              {activeProjectName && activeProjectName !== dubFilename && (
                <span className="dub-head__project">— {activeProjectName}</span>
              )}
            </div>
            <div className="dub-head__actions">
              <Button variant="subtle" size="sm" onClick={saveProject} leading={<Save size={9} />}>{t('common.save')}</Button>
              <Button variant="danger" size="sm" onClick={resetDub}>{t('common.reset')}</Button>
            </div>
          </div>

          <div className="dub-split-grid dub-split-2">
            {/* TRÁI: Waveform + Video */}
            <div className="studio-panel dub-panel-col">
              {hasDubbedTrack && (
                <div className="dub-preview-toggle">
                  <span className="dub-preview-toggle__kicker">{t('dub.preview')}</span>
                  <Segmented
                    size="sm"
                    value={previewMode}
                    onChange={setPreviewMode}
                    items={[
                      { value: 'original', label: t('dub.original') },
                      { value: 'dubbed',   label: `${t('dub.dubbed')} (${dubLangCode})` },
                    ]}
                  />
                  {previewMode === 'dubbed' && (
                    <span className="dub-preview-toggle__hint">{t('dub.mux_hint')}</span>
                  )}
                </div>
              )}
              <WaveformTimeline
                key={videoSrc}
                ref={waveformRef}
                audioSrc={`${API}/dub/audio/${dubJobId}`}
                videoSrc={videoSrc}
                segments={dubSegments}
                onSegmentsChange={setDubSegments}
                disabled={dubStep === 'generating' || dubStep === 'stopping'}
                overlayContent={(dubStep === 'generating' || dubStep === 'stopping') ? (
                  <div className="dub-gen-overlay">
                    <div className="dub-gen-overlay__head">
                      {dubStep === 'stopping' ? <Loader className="spinner" size={14} color="#a89984" /> : <Sparkles className="spinner" size={14} color="#d3869b" />}
                      <span className={`dub-gen-overlay__title ${dubStep === 'stopping' ? 'is-stopping' : ''}`}>
                        {dubStep === 'stopping' ? t('dub.stopping') : t('dub.dubbing_progress', { current: dubProgress.current, total: dubProgress.total })}
                      </span>
                    </div>
                    {dubStep === 'generating' && (
                      <>
                        <div className="dub-gen-overlay__stats">
                          <span>⏱ {fmtDur(genElapsed)} {t('dub.elapsed')}</span>
                          {genRemaining !== null && <span>~{fmtDur(genRemaining)} {t('dub.remaining')}</span>}
                        </div>
                        <div className="dub-gen-overlay__bar">
                          <Progress
                            value={dubProgress.total ? (dubProgress.current / dubProgress.total) * 100 : 0}
                            tone="brand"
                            size="sm"
                          />
                        </div>
                        {dubProgress.text && <span className="dub-gen-overlay__text">{dubProgress.text}</span>}
                      </>
                    )}
                  </div>
                ) : null}
              />

              {/* Cast — chỉ định giọng nói cho từng người nói được phát hiện. Khi trình trích xuất
                  auto-clone tìm thấy một đoạn phù hợp cho mỗi người nói (≥5 giây từ giọng hát bị cô lập),
                  tùy chọn đó trở thành lựa chọn hàng đầu trong dropdown. Nó cũng được chọn sẵn trên
                  các phân đoạn để "ngôn ngữ mới = cùng một giọng của người nói" hoạt động theo mặc định. */}
              {dubSegments.some(s => s.speaker_id) && (
                <div className="dub-cast">
                  <div className="dub-cast__row">
                    <span className="dub-cast__kicker" title={t('dub.cast_hint')}>CAST</span>
                    {[...new Set(dubSegments.map(s => s.speaker_id).filter(Boolean))].map(spk => {
                      const autoId = `auto:${(spk || '').toLowerCase().replace(/\s+/g, '_')}`;
                      const clone = speakerClones[spk];
                      return (
                        <div key={spk} className="dub-cast__pair">
                          <span className="dub-cast__label">{spk}:</span>
                          <select className="input-base dub-cast__select"
                            value={dubSegments.find(s => s.speaker_id === spk)?.profile_id || ''}
                            onChange={e => {
                              const val = e.target.value;
                              setDubSegments(dubSegments.map(s => s.speaker_id === spk ? { ...s, profile_id: val } : s));
                            }}>
                            {clone && (
                              <option value={autoId}>{t('dub.from_video')} · {clone.duration.toFixed(1)}s</option>
                            )}
                            <option value="">{t('dub.default')}</option>
                            {profiles.length > 0 && (
                              <optgroup label={t('dub.clone_profiles')}>
                                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </optgroup>
                            )}
                            {PRESETS.length > 0 && (
                              <optgroup label={t('dub.design_presets')}>
                                {PRESETS.map(p => <option key={p.id} value={`preset:${p.id}`}>{p.name}</option>)}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Cài đặt dịch — thu gọn hoặc mở rộng */}
              {!settingsOpen && (
                <div className="dub-settings-summary">
                  <button
                    type="button"
                    className="dub-settings-summary__trigger"
                    onClick={() => setSettingsOpen(true)}
                    title={t('dub.edit_settings_hint', 'Chỉnh sửa cài đặt dịch')}
                  >
                    <ChevronDown size={10} />
                    <span><strong>{dubLang}</strong> · {dubLangCode} · {translateQuality} · <span style={{ color: activeEngineUnavailable ? '#fb4934' : '#b8bb26' }}>●</span> {translateProvider}</span>
                    {dubInstruct && <span className="dub-settings-summary__style">{t('dub.style')}: {dubInstruct}</span>}
                  </button>
                  <Button
                    variant="subtle" size="sm"
                    onClick={handleTranslateAll}
                    disabled={isTranslating || !dubSegments.length}
                    loading={isTranslating}
                    leading={!isTranslating && <Languages size={10} />}
                  >
                    {isTranslating ? `${t('dub.transcribing_whisper')}…` : hasAnyTranslation ? t('dub.re_translate') : t('dub.translate_all')}
                  </Button>
                  <Button
                    variant="subtle" size="sm"
                    onClick={handleCleanupSegments}
                    disabled={!dubSegments.length || !dubJobId}
                    title={t('dub.clean_up_hint', 'Hợp nhất các đoạn nhỏ và các phân đoạn ngắn liền kề')}
                    leading={<Wand2 size={10} />}
                  >
                    {t('dub.clean_up')}
                  </Button>
                </div>
              )}
              {settingsOpen && (
              <div className="dub-settings-bar">
                <div className="dub-settings-bar__fields">
                  <button
                    type="button"
                    className="dub-settings-summary__trigger dub-settings-close"
                    onClick={() => setSettingsOpen(false)}
                    title={t('dub.collapse_settings_hint', 'Thu gọn cài đặt dịch')}
                  >
                    <ChevronUp size={10} />
                  </button>
                  <div className="dub-settings-field dub-settings-field--lang">
                    <div className="label-row"><Globe className="label-icon" size={9} /> {t('voice.language')}</div>
                    <select
                      className="input-base dub-cast__select"
                      value={dubLang}
                      onChange={(e) => {
                        const lang = e.target.value;
                        setDubLang(lang);
                        const match = LANG_CODES.find(lc => lc.label.toLowerCase() === lang.toLowerCase());
                        if (match) setDubLangCode(match.code);
                      }}
                    >
                      <optgroup label={t('dub.popular')}>
                        {POPULAR_LANGS.map(l => <option key={`p-${l}`} value={l}>{l}</option>)}
                      </optgroup>
                      <optgroup label={t('dub.all_languages')}>
                        {ALL_LANGUAGES
                          .filter(l => !POPULAR_LANGS.includes(l))
                          .map(l => <option key={l} value={l}>{l}</option>)}
                      </optgroup>
                    </select>
                  </div>
                  <div className="dub-settings-field dub-settings-field--iso">
                    <div className="label-row">{t('dub.iso_code')}</div>
                    <select
                      className="input-base dub-cast__select"
                      value={dubLangCode}
                      onChange={(e) => setDubLangCode(e.target.value)}
                    >
                      {LANG_CODES.map(lc => (
                        <option key={lc.code} value={lc.code}>{lc.code} — {lc.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="dub-settings-field dub-settings-field--engine">
                    <div className="label-row">
                      {t('dub.engine')}
                      {activeEngineUnavailable && !enginesSandboxed && (
                        <button
                          type="button"
                          className="dub-engine-install-chip"
                          onClick={() => handleInstallEngine(translateProvider)}
                          disabled={engineInstalling === translateProvider}
                          title={activeEngineEntry?.notes || t('dub.install_engine_hint', 'Cài đặt công cụ này')}
                        >
                          {engineInstalling === translateProvider ? `…${t('status_uploading')}…` : `+ cài đặt ${activeEngineEntry?.pip_package || ''}`}
                        </button>
                      )}
                      {activeEngineUnavailable && enginesSandboxed && (
                        <span className="dub-engine-install-chip dub-engine-install-chip--disabled" title={t('dub.sandboxed_hint', 'Cài đặt bị vô hiệu hóa trong các bản đóng gói')}>
                          cần cài đặt thủ công (dev)
                        </span>
                      )}
                    </div>
                    <select className="input-base dub-engine-select" value={translateProvider} onChange={e => setTranslateProvider(e.target.value)}>
                      {(engines.length ? engines : [
                        { id: 'argos', display_name: 'Argos (Nhanh - Nội bộ)', installed: true },
                        { id: 'nllb', display_name: 'NLLB (Nặng - Nội bộ)', installed: true },
                        { id: 'google', display_name: 'Google (Trực tuyến)', installed: true },
                        { id: 'openai', display_name: 'OpenAI (LLM)', installed: true },
                      ]).map(p => (
                        <option key={p.id} value={p.id}>
                          {p.installed ? p.display_name : `${p.display_name} — cần cài đặt`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="dub-settings-field dub-settings-field--quality">
                    <div className="label-row" title={t('dub.quality_hint', 'Điện ảnh = tinh chỉnh LLM 3 bước (dịch → phản chiếu → thích ứng). Cần cấu hình LLM.')}>{t('dub.quality')}</div>
                    <Segmented
                      size="sm"
                      value={translateQuality}
                      onChange={setTranslateQuality}
                      items={[
                        { value: 'fast',      label: t('dub.fast') },
                        { value: 'cinematic', label: t('dub.cinematic') },
                      ]}
                    />
                  </div>
                  <div className="dub-settings-field dub-settings-field--style">
                    <div className="label-row"><UserSquare2 className="label-icon" size={9} /> {t('dub.style')} <span className="dub-settings-field__hint">{t('dub.optional')}</span></div>
                    <input className="input-base input-base--xs" placeholder={t('dub.style_placeholder')} value={dubInstruct} onChange={e => setDubInstruct(e.target.value)} />
                  </div>
                  <div className="dub-settings-field dub-settings-field--multi">
                    <label className="dub-multi-toggle">
                      <input
                        type="checkbox"
                        checked={multiLangMode}
                        onChange={e => setMultiLangMode(e.target.checked)}
                      />
                      <span>{t('dub.multi_lang')}</span>
                    </label>
                    {multiLangMode && (
                      <MultiLangPicker
                        selected={multiLangs}
                        onChange={setMultiLangs}
                        disabled={dubStep === 'generating'}
                      />
                    )}
                  </div>
                </div>
                <div className="dub-settings-bar__actions">
                  <Button
                    variant="subtle" size="sm"
                    onClick={() => editSegments(dubSegments.map(s => ({ ...s, text: s.text_original || s.text, translate_error: undefined })))}
                    disabled={!dubSegments.some(s => s.text_original && s.text_original !== s.text)}
                    title={t('dub.restore_hint')}
                  >
                    ↺ {t('dub.restore')}
                  </Button>
                  <Button
                    variant="subtle" size="sm"
                    onClick={handleCleanupSegments}
                    disabled={!dubSegments.length || !dubJobId}
                    title={t('dub.clean_up_hint')}
                    leading={<Wand2 size={10} />}
                  >
                    {t('dub.clean_up')}
                  </Button>
                  <Button
                    variant="primary" size="sm"
                    onClick={handleTranslateAll}
                    disabled={isTranslating || !dubSegments.length}
                    loading={isTranslating}
                    leading={!isTranslating && <Languages size={10} />}
                  >
                    {isTranslating ? `${t('dub.transcribing_whisper')}…` : t('dub.translate_all')}
                  </Button>
                </div>
              </div>
              )}
            </div>

            {/* PHẢI: Bảng phân đoạn */}
            <div className="studio-panel dub-panel-col">

              {dubTranscript && (
                <div className="dub-transcript-toggle-wrap">
                  <div className="override-toggle dub-transcript-toggle__inner" onClick={() => setShowTranscript(!showTranscript)}>
                    <span><FileText size={10} className="dub-inline-icon" /> {t('dub.transcript')}</span>
                    {showTranscript ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </div>
                  {showTranscript && (
                    <div className="dub-transcript-body">
                      {dubTranscript}
                    </div>
                  )}
                </div>
              )}

              {/* Phase 1.3 — Thuật ngữ dự án. Ẩn sau một chip cho đến khi
                  người dùng muốn (hoặc các thuật ngữ đã tồn tại). */}
              {dubJobId && !glossaryVisible && (
                <button
                  type="button"
                  className="dub-glossary-chip"
                  onClick={() => setGlossaryOpen(true)}
                  title={t('dub.glossary_hint')}
                >
                  {t('dub.glossary')} (0)
                </button>
              )}
              {dubJobId && glossaryVisible && (
                <div className="dub-glossary-wrap">
                  <GlossaryPanel
                    projectId={dubJobId}
                    sourceLang={dubLangCode && dubLang ? (dubLang.slice(0, 2).toLowerCase() || 'en') : 'en'}
                    targetLang={dubLangCode}
                    segments={dubSegments}
                    onChange={onGlossaryChange}
                  />
                </div>
              )}

              {/* "Apply Voice to All" row removed 2026-04-21 — redundant
                  with the CAST strip in the left column, which does the same
                  thing per-speaker (and handles the multi-speaker case cleanly). */}

              {selectedSegIds.size > 0 && (
                <div className="dub-bulk-row dub-bulk-row--select">
                  <span className="dub-bulk-row__label-brand">{t('dub.selected', { count: selectedSegIds.size })}</span>
                  <select className="input-base dub-bulk-select dub-bulk-select--voice"
                    value="" onChange={(e) => { const v = e.target.value; if (v === '__clear__') bulkApplyToSelected({ profile_id: '' }); else if (v) bulkApplyToSelected({ profile_id: v }); }}>
                    <option value="">{t('dub.set_voice')}</option>
                    <option value="__clear__">⊘ {t('dub.default')}</option>
                    {speakerClones && Object.keys(speakerClones).length > 0 && (
                      <optgroup label={t('dub.from_video')}>
                        {Object.keys(speakerClones).map(spk => {
                          const autoId = `auto:${(spk || '').toLowerCase().replace(/\s+/g, '_')}`;
                          return <option key={autoId} value={autoId}>🎤 {spk}</option>;
                        })}
                      </optgroup>
                    )}
                    {profiles.filter(p => !p.instruct).length > 0 && (
                      <optgroup label={t('sidebar.clone')}>
                        {profiles.filter(p => !p.instruct).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </optgroup>
                    )}
                    {profiles.filter(p => !!p.instruct).length > 0 && (
                      <optgroup label={t('sidebar.design')}>
                        {profiles.filter(p => !!p.instruct).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <select className="input-base dub-bulk-select dub-bulk-select--lang"
                    value="" onChange={(e) => { if (e.target.value === '__def__') bulkApplyToSelected({ target_lang: null }); else if (e.target.value) bulkApplyToSelected({ target_lang: e.target.value }); }}>
                    <option value="">{t('dub.set_lang')}</option>
                    <option value="__def__">({t('dub.default')})</option>
                    {LANG_CODES.map(lc => <option key={lc.code} value={lc.code}>{lc.code.toUpperCase()}</option>)}
                  </select>
                  <Button variant="danger" size="sm" onClick={bulkDeleteSelected}>{t('common.delete')}</Button>
                  <Button variant="ghost"  size="sm" onClick={clearSegSelection} className="dub-bulk-row__clear">{t('sidebar.clear')}</Button>
                </div>
              )}

              {showCheckpoint && (
                <CheckpointBanner
                  stage={checkpointStage}
                  count={dubSegments.length}
                  onContinue={checkpointStage === 'done' ? null : onCheckpointContinue}
                  onDismiss={onCheckpointDismiss}
                  continueLoading={isTranslating}
                />
              )}

              <Suspense fallback={<LazyFallback />}>
                <DubSegmentTable
                  segments={dubSegments}
                  profiles={profiles}
                  speakerClones={speakerClones}
                  dubStep={dubStep}
                  dubProgress={dubProgress}
                  previewLoadingId={segmentPreviewLoading}
                  selectedIds={selectedSegIds}
                  onSelect={toggleSegSelect}
                  onSelectAll={selectAllSegs}
                  onClearSelection={clearSegSelection}
                  onEditField={segmentEditField}
                  onDelete={segmentDelete}
                  onRestore={segmentRestoreOriginal}
                  onPreview={handleSegmentPreview}
                  onDirect={onDirectSegment}
                  onSplit={segmentSplit}
                  onMerge={segmentMerge}
                  onSeek={seekWaveform}
                />
              </Suspense>
            </div>
          </div>

          {/* Actions footer */}
          <div className="studio-panel dub-footer-panel">
            {dubStep === 'done' && (
              <div className="dub-footer-banner">
                <Badge tone="success">
                  <Check size={11} /> {t('dub.done')} {t('dub.tracks')}: {dubTracks.join(', ')}
                </Badge>
                {incrementalPlan && incrementalPlan.stale?.length > 0 && (
                  <Badge tone="warn" className="dub-footer-banner__badge-gap">
                    {t('dub.segments_changed', { count: incrementalPlan.stale.length })}
                  </Badge>
                )}
                {incrementalPlan && incrementalPlan.stale?.length === 0 && incrementalPlan.fresh?.length > 0 && (
                  <Badge tone="neutral" className="dub-footer-banner__badge-gap">
                    {t('dub.all_up_to_date', { count: incrementalPlan.fresh.length })}
                  </Badge>
                )}
              </div>
            )}
            {dubError && (
              <div className="dub-footer-banner">
                <Badge tone="danger">
                  <AlertCircle size={11} /> {dubError}
                </Badge>
              </div>
            )}
            <div className="dub-outputs-row">
              <span className="dub-outputs-title-strong">{t('dub.output_options')}</span>
              <label>
                <input type="checkbox" checked={preserveBg} onChange={e => setPreserveBg(e.target.checked)} /> {t('dub.mix_bg')}
              </label>
              <label title={t('dub.dual_subs_hint', 'Xuất phụ đề với văn bản đã dịch ở trên và bản gốc in nghiêng ở dưới.')}>
                <input type="checkbox" checked={!!dualSubs} onChange={e => setDualSubs(e.target.checked)} /> {t('dub.dual_subs')}
              </label>
              <label title={t('dub.burn_subs_hint', 'Render phụ đề trực tiếp vào luồng video MP4 (hardsubs). Sử dụng định dạng phụ đề song ngữ khi Phụ đề song ngữ được bật.')}>
                <input type="checkbox" checked={!!burnSubs} onChange={e => setBurnSubs(e.target.checked)} /> {t('dub.burn_subs')}
              </label>
              <label>
                {t('dub.default_track')}
                <select className="input-base dub-outputs-default" value={defaultTrack} onChange={e => setDefaultTrack(e.target.value)}>
                  <option value="original">{t('dub.original')}</option>
                  {dubLangCode && <option value={dubLangCode}>{dubLangCode} ({t('dub.selected_dub')})</option>}
                  {dubTracks.filter(t => t !== dubLangCode).map(t => (
                    <option key={t} value={t}>{t} ({t('sidebar.dub')})</option>
                  ))}
                </select>
              </label>
            </div>
            {dubTracks.length > 0 && (
              <div className="dub-tracks-row">
                <span className="dub-tracks-row__title">{t('dub.export_tracks')}</span>
                <label className={exportTracks['original'] ? 'is-on' : 'is-off'}>
                  <input type="checkbox" checked={exportTracks['original'] !== false} onChange={e => setExportTracks(prev => ({ ...prev, original: e.target.checked }))} />
                  <span>{t('dub.original')}</span>
                </label>
                {dubTracks.map(t => (
                  <label key={t} className={exportTracks[t] !== false ? 'is-on is-success' : 'is-off'}>
                    <input type="checkbox" checked={exportTracks[t] !== false} onChange={e => setExportTracks(prev => ({ ...prev, [t]: e.target.checked }))} />
                    <span className="code">{t}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="dub-footer-btns">
              {dubStep === 'stopping' ? (
                <FooterBtn tone="stopping" disabled icon={<Loader className="spinner" size={9} />} label={t('dub.stopping')} />
              ) : dubStep === 'generating' ? (
                <FooterBtn tone="danger" onClick={handleDubStop} icon={<Square size={9} />}
                  label={`${t('dub.stop')} (${dubProgress.current}/${dubProgress.total})`} />
              ) : (
                <>
                  <FooterBtn tone={dubSegments.length ? 'pink' : 'idle'} onClick={() => handleDubGenerate()}
                    disabled={!dubSegments.length} icon={<Play size={11} />} label={t('dub.generate_dub')} />
                  {dubStep === 'done' && incrementalPlan && incrementalPlan.stale?.length > 0 && (
                    <FooterBtn
                      tone="pink"
                      onClick={() => handleDubGenerate({ regenOnly: incrementalPlan.stale, preview: true })}
                      icon={<Play size={11} />}
                      label={t('dub.regen', { count: incrementalPlan.stale.length })}
                    />
                  )}
                </>
              )}
              <FooterBtn
                tone={dubStep === 'done' ? 'green' : 'idle'}
                disabled={dubStep !== 'done' && !dubSegments.length}
                onClick={() => setExportOpen(true)}
                icon={<Download size={11} />}
                label={t('dub.export_btn')}
              />
            </div>
          </div>
        </div>
      )}

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        jobId={dubJobId}
        filename={dubFilename}
        dubTracks={dubTracks}
        dubLangCode={dubLangCode}
        preserveBg={preserveBg} setPreserveBg={setPreserveBg}
        defaultTrack={defaultTrack} setDefaultTrack={setDefaultTrack}
        exportTracks={exportTracks} setExportTracks={setExportTracks}
        dualSubs={dualSubs} setDualSubs={setDualSubs}
        burnSubs={burnSubs} setBurnSubs={setBurnSubs}
        API={API}
        triggerDownload={triggerDownload}
        handleDubDownload={handleDubDownload}
        handleDubAudioDownload={handleDubAudioDownload}
        handleAudioExport={handleAudioExport}
        segmentCount={dubSegments.length}
        onEnterprise={() => useAppStore.getState().setMode?.('enterprise')}
      />
    </div>
  );
}

function fmtDur(s) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec ? `${m}m ${sec}s` : `${m}m`;
}

const PREP_STAGE_LABEL = (t) => ({
  download: t('dub.downloading_video'),
  extract:  t('dub.extract_audio'),
  demucs:   t('dub.sep_vocals'),
  scene:    t('dub.detect_scenes'),
  cached:   t('dub.using_cached'),
});
const PREP_FULL   = ['download', 'extract', 'demucs', 'scene'];
const PREP_CACHED = ['download', 'extract', 'cached'];

/**
 * PrepOverlay — chỉ báo giai đoạn chuẩn bị tải lên.
 * `large` làm cho khung bao quanh lớn hơn (được sử dụng cho vùng thả trạng thái trống).
 */
function PrepOverlay({ stage, onAbort, large = false }) {
  const { t } = useTranslation();
  const stages = stage === 'cached' ? PREP_CACHED : PREP_FULL;
  const labels = PREP_STAGE_LABEL(t);
  const body = (
    <>
      <Loader className="spinner" size={large ? 28 : 20} color="#d3869b" />
      <span className="dub-prep-overlay__title" style={{ fontSize: large ? '0.95rem' : '0.85rem' }}>
        {labels[stage] || t('dub.preparing')}
      </span>
      <div className={`dub-prep-chips ${large ? 'dub-prep-chips--lg' : ''}`}>
        {stages.map(s => (
          <span
            key={s}
            className={`dub-prep-chip ${stage === s ? 'is-active' : ''} ${s === 'cached' ? 'is-cached' : ''}`}
          >
            {s === 'cached' ? '⚡ cached' : s}
          </span>
        ))}
      </div>
      {stage === 'demucs' && (
        <span className="dub-prep-overlay__note">
          {t('dub.demucs_note')}
        </span>
      )}
      <Button variant="danger" size="sm" onClick={onAbort} leading={<Square size={11} />}>
        {t('dub.stop')}
      </Button>
    </>
  );
  return large
    ? <div className="dub-prep-overlay dub-prep-overlay--large">{body}</div>
    : <div className="dub-prep-overlay">{body}</div>;
}

/**
 * TranscribeOverlay — tiến trình Whisper + ETA khi đang transcribe.
 */
function TranscribeOverlay({ elapsed, duration, onAbort }) {
  const { t } = useTranslation();
  const est = duration > 0 ? Math.max(10, Math.ceil(duration / 60) * 3 + 8) : 0;
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, '0');
  return (
    <div className="dub-trans-overlay">
      <div className="dub-trans-overlay__head">
        <Loader className="spinner" size={18} color="#d3869b" />
        <span className="dub-trans-overlay__title">{t('dub.transcribing_whisper')}</span>
      </div>
      <div className="dub-trans-overlay__stats">
        <span>⏱ {mm}:{ss} {t('dub.elapsed')}</span>
        {est > 0 && <span>~{Math.max(0, est - elapsed)}s {t('dub.remaining')}</span>}
      </div>
      {duration > 0 && (
        <div className="dub-trans-overlay__bar">
          <Progress value={Math.min(95, (elapsed / est) * 100)} tone="brand" size="sm" />
        </div>
      )}
      <Button variant="danger" size="sm" onClick={onAbort} leading={<Square size={11} />}>
        {t('dub.stop')}
      </Button>
    </div>
  );
}

/**
 * FooterBtn — họ nút tải xuống có gradient theo từng tone trong action footer.
 * Sử dụng .btn-primary cũ làm hình dạng/nền hover, chỉ chọn một lớp tone.
 * forwardRef để <Menu> có thể nối triggerRef của nó với nút bên dưới —
 * nếu không có cái này, menu Export không thể tính toán tọa độ và không bao giờ mở được.
 */
const FooterBtn = React.forwardRef(function FooterBtn(
  { tone = 'idle', sm = false, disabled, onClick, icon, label, ...rest },
  ref,
) {
  const cls = [
    'btn-primary',
    'dub-footer-btn',
    sm && 'dub-footer-btn--sm',
    `dub-footer-btn--${tone}`,
  ].filter(Boolean).join(' ');
  return (
    <button ref={ref} className={cls} disabled={disabled} onClick={onClick} {...rest}>
      {icon} {label}
    </button>
  );
});
