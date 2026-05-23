import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from 'react';
import './index.css';
import { useTranslation, Trans } from 'react-i18next';
import { useAppStore } from './store';
import SearchableSelect from './components/SearchableSelect';
import DirectionDialog from './components/DirectionDialog';

// Lazy-load các component nặng/theo điều kiện để không làm phình bản build ban đầu.
const AudioTrimmer = lazy(() => import('./components/AudioTrimmer'));
const Launchpad = lazy(() => import('./pages/Launchpad'));
const CloneDesignTab = lazy(() => import('./pages/CloneDesignTab'));
const DubTab = lazy(() => import('./pages/DubTab'));
const Sidebar = lazy(() => import('./components/Sidebar'));
const CompareModal = lazy(() => import('./components/CompareModal'));
const Settings = lazy(() => import('./pages/Settings'));
const VoiceProfile = lazy(() => import('./pages/VoiceProfile'));
const BatchQueue = lazy(() => import('./pages/BatchQueue'));
const ToolsPage = lazy(() => import('./pages/ToolsPage'));
const SetupWizard = lazy(() => import('./pages/SetupWizard'));
const KeyboardCheatsheet = lazy(() => import('./components/KeyboardCheatsheet'));
const VoicePreview = lazy(() => import('./components/VoicePreview'));
const LogsFooter = lazy(() => import('./components/LogsFooter'));
const ProjectsPage = lazy(() => import('./pages/Projects'));
const VoiceGallery = lazy(() => import('./pages/VoiceGallery'));
const DonatePage = lazy(() => import('./pages/DonatePage'));
const EnterprisePage = lazy(() => import('./pages/EnterprisePage'));
const TranscriptionsPage = lazy(() => import('./pages/Transcriptions'));
const StoriesEditor = lazy(() => import('./components/StoriesEditor'));

import Header from './components/Header';
import NavRail from './components/NavRail';
import ErrorBoundary from './components/ErrorBoundary';
import FloatingPill from './components/FloatingPill';

import useRealtimeEvents from './hooks/useRealtimeEvents';
import { BootstrapSplash, useBootstrapStage } from './components/BootstrapSplash';

import './components/Misc.css';
import { askConfirm } from './utils/dialog';
import useRecording from './hooks/useRecording';
import useSegmentEditing from './hooks/useSegmentEditing';
import useAppData from './hooks/useAppData';
import useProfiles from './hooks/useProfiles';
import useTTS from './hooks/useTTS';
import useDubWorkflow from './hooks/useDubWorkflow';

const LazyFallback = () => {
  const { t } = useTranslation();
  return <div className="app-lazy-fallback">{t('common.loading')}</div>;
};

import { Toaster, toast } from 'react-hot-toast';
import {
  POPULAR_LANGS, POPULAR_ISO, TAGS, CATEGORIES, PRESETS, CLONE_MAX_SECONDS,
} from './utils/constants';
import { LANG_CODES } from './utils/languages';
import { formatTime } from './utils/format';
import { API, apiPost } from './api/client';
import { flushMemory as apiFlushMemory } from './api/system';
import { saveProject as apiSaveProject, loadProject as apiLoadProject, deleteProject as apiDeleteProject } from './api/projects';
import { exportAction, exportReveal, exportRecord } from './api/exports';

import { isTauri, doubleClickMaximize, fileToMediaUrl, playBlobAudio, playPing } from './utils/media';

function App() {
  const { t } = useTranslation();

  // Bootstrap lần đầu: Rust kích hoạt uv sync trong một thread nền và
  // công bố tiến trình qua lệnh Tauri `bootstrap_status`. Hook bên dưới
  // truy vấn mỗi 1 giây; cho đến khi `ready`, chúng ta render BootstrapSplash thay vì
  // shell ứng dụng bình thường, để người dùng thấy tiến trình thực tế thay vì giao diện bị treo.
  const { stage: bootstrapStage, message: bootstrapMessage } = useBootstrapStage();

  // Trạng thái điều hướng UI hiện nằm trong Zustand `uiSlice` (Phase 2.2).
  // Mode + uiScale + sidebar-collapsed tự động duy trì qua các lần tải lại
  // thông qua `partialize` của store; id dự án / giọng nói đang hoạt động vẫn mang tính tạm thời.
  const uiScale = useAppStore(s => s.uiScale);
  const setUiScale = useAppStore(s => s.setUiScale);
  const theme = useAppStore(s => s.theme);

  // Khởi tạo theme khi mount để tùy chọn đã lưu có hiệu lực.
  useEffect(() => {
    if (theme && theme !== 'gruvbox') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mode = useAppStore(s => s.mode);
  const setMode = useAppStore(s => s.setMode);
  const [navRailSide, setNavRailSide] = useState(() => {
    try { return localStorage.getItem('omnivoice.navRailSide') || 'left'; } catch { return 'left'; }
  });
  const showCheatsheet = useAppStore(s => s.showCheatsheet);
  const setShowCheatsheet = useAppStore(s => s.setShowCheatsheet);

  // Phím nóng toàn cục '?' → mở bảng phím tắt
  useEffect(() => {
    const h = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowCheatsheet(v => !v);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Lắng nghe các sự kiện điều hướng từ khay hệ thống (Tauri desktop)
  useEffect(() => {
    let unlisten;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('tray-navigate', (ev) => {
          if (ev.payload) setMode(ev.payload);
        });
      } catch { /* không phải trong Tauri */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, [setMode]);

  const flipNavRailSide = useCallback(() => {
    setNavRailSide(prev => {
      const next = prev === 'left' ? 'right' : 'left';
      try { localStorage.setItem('omnivoice.navRailSide', next); } catch {}
      return next;
    });
  }, []);

  // Điều hướng hồ sơ giọng nói — slice sở hữu "nhớ tôi đã ở đâu" cho nút Quay lại.
  const activeVoiceId = useAppStore(s => s.activeVoiceId);
  const openVoiceProfile = useAppStore(s => s.openVoiceProfile);
  const closeVoiceProfile = useAppStore(s => s.closeVoiceProfile);
  const hideSidebar = mode === 'launchpad' || mode === 'settings' || mode === 'voice' || mode === 'donate'
    || mode === 'queue' || mode === 'tools' || mode === 'projects' || mode === 'gallery' || mode === 'enterprise' || mode === 'transcriptions'
    || mode === 'stories';
  const availableSidebarTabs = mode === 'dub'
    ? ['projects', 'history', 'downloads']
    : (mode === 'clone' || mode === 'design')
      ? ['projects', 'history']
      : [];

  // Tùy chọn tab Generate hiện nằm trong `generateSlice` (Phase 2.2).
  // Các núm điều chỉnh đã lưu sẽ tồn tại qua các lần tải lại nhờ `partialize` của store.
  const text              = useAppStore(s => s.text);
  const setText           = useAppStore(s => s.setText);
  const refText         = useAppStore(s => s.refText);
  const setRefText      = useAppStore(s => s.setRefText);
  const instruct        = useAppStore(s => s.instruct);
  const setInstruct     = useAppStore(s => s.setInstruct);
  const language        = useAppStore(s => s.language);
  const setLanguage     = useAppStore(s => s.setLanguage);

  const speed           = useAppStore(s => s.speed);
  const setSpeed        = useAppStore(s => s.setSpeed);
  const steps           = useAppStore(s => s.steps);
  const setSteps        = useAppStore(s => s.setSteps);
  const cfg             = useAppStore(s => s.cfg);
  const setCfg          = useAppStore(s => s.setCfg);
  const denoise         = useAppStore(s => s.denoise);
  const setDenoise      = useAppStore(s => s.setDenoise);
  const tShift          = useAppStore(s => s.tShift);
  const setTShift       = useAppStore(s => s.setTShift);
  const posTemp         = useAppStore(s => s.posTemp);
  const setPosTemp      = useAppStore(s => s.setPosTemp);
  const classTemp       = useAppStore(s => s.classTemp);
  const setClassTemp    = useAppStore(s => s.setClassTemp);
  const layerPenalty    = useAppStore(s => s.layerPenalty);
  const setLayerPenalty = useAppStore(s => s.setLayerPenalty);
  const postprocess     = useAppStore(s => s.postprocess);
  const setPostprocess  = useAppStore(s => s.setPostprocess);
  const duration        = useAppStore(s => s.duration);
  const setDuration     = useAppStore(s => s.setDuration);
  const vdStates        = useAppStore(s => s.vdStates);
  const setVdStates     = useAppStore(s => s.setVdStates);

  // ═══ HOOKS ĐÃ TRÍCH XUẤT ═══
  const {
    profiles, history, dubHistory, studioProjects, exportHistory,
    showOverrides, setShowOverrides,
    sysStats, modelStatus,
    loadProfiles, loadHistory, loadDubHistory, loadProjects, loadExportHistory,
  } = useAppData();

  const {
    selectedProfile, setSelectedProfile,
    showSaveProfile, setShowSaveProfile,
    profileName, setProfileName,
    previewLoading, segmentPreviewLoading,
    isVoicePreviewOpen, setIsVoicePreviewOpen,
    voicePreviewProfileId, setVoicePreviewProfileId,
    handleSaveProfile: _handleSaveProfile,
    handleDeleteProfile, handleSelectProfile,
    handlePreviewVoice, handleSegmentPreview,
    handleSaveHistoryAsProfile, handleLockProfile, handleUnlockProfile,
  } = useProfiles({ loadHistory, loadProfiles });

  const {
    refAudio, setRefAudio,
    pendingTrimFile, setPendingTrimFile,
    isGenerating, generationTime,
    textAreaRef,
    ingestRefAudio, insertTag, applyPreset,
    handleGenerate,
  } = useTTS({ selectedProfile, setSelectedProfile, loadHistory });

  const handleSaveProfile = () => _handleSaveProfile(refAudio, refText, instruct, language);

  // Trạng thái so sánh giọng nói A/B
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [compareVoiceA, setCompareVoiceA] = useState("");
  const [compareVoiceB, setCompareVoiceB] = useState("");
  const [compareText, setCompareText] = useState("The quick brown fox jumps over the lazy dog, proving that this voice sounds much better.");
  const [compareResultA, setCompareResultA] = useState(null);
  const [compareResultB, setCompareResultB] = useState(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareProgress, setCompareProgress] = useState("");

  // ═══ GHI ÂM TỪ MIC ═══
  const {
    isRecording, isCleaning, recordingTime,
    startRecording, stopRecording,
  } = useRecording(ingestRefAudio);

  // ═══ TRẠNG THÁI LỒNG TIẾNG (DUB) ═══
  const dubJobId           = useAppStore(s => s.dubJobId);
  const setDubJobId        = useAppStore(s => s.setDubJobId);
  const dubStep            = useAppStore(s => s.dubStep);
  const setDubStep         = useAppStore(s => s.setDubStep);
  const dubSegments        = useAppStore(s => s.dubSegments);
  const setDubSegments     = useAppStore(s => s.setDubSegments);
  const dubLang            = useAppStore(s => s.dubLang);
  const setDubLang         = useAppStore(s => s.setDubLang);
  const dubLangCode        = useAppStore(s => s.dubLangCode);
  const setDubLangCode     = useAppStore(s => s.setDubLangCode);
  const dubInstruct        = useAppStore(s => s.dubInstruct);
  const setDubInstruct     = useAppStore(s => s.setDubInstruct);
  const dubProgress        = useAppStore(s => s.dubProgress);
  const setDubProgress     = useAppStore(s => s.setDubProgress);
  const dubFilename        = useAppStore(s => s.dubFilename);
  const setDubFilename     = useAppStore(s => s.setDubFilename);
  const dubDuration        = useAppStore(s => s.dubDuration);
  const setDubDuration     = useAppStore(s => s.setDubDuration);
  const dubError           = useAppStore(s => s.dubError);
  const setDubError        = useAppStore(s => s.setDubError);
  const dubTracks          = useAppStore(s => s.dubTracks);
  const setDubTracks       = useAppStore(s => s.setDubTracks);
  const dubTranscript      = useAppStore(s => s.dubTranscript);
  const setDubTranscript   = useAppStore(s => s.setDubTranscript);
  const isTranslating      = useAppStore(s => s.isTranslating);
  const setIsTranslating   = useAppStore(s => s.setIsTranslating);
  const preserveBg         = useAppStore(s => s.preserveBg);
  const setPreserveBg      = useAppStore(s => s.setPreserveBg);
  const defaultTrack       = useAppStore(s => s.defaultTrack);
  const setDefaultTrack    = useAppStore(s => s.setDefaultTrack);
  const exportTracks       = useAppStore(s => s.exportTracks);
  const setExportTracks    = useAppStore(s => s.setExportTracks);
  const previewSegIds      = useAppStore(s => s.previewSegIds);
  const setPreviewSegIds   = useAppStore(s => s.setPreviewSegIds);
  const speakerClones      = useAppStore(s => s.speakerClones);
  const setSpeakerClones   = useAppStore(s => s.setSpeakerClones);
  const dubTaskId          = useAppStore(s => s.dubTaskId);
  const setDubTaskId       = useAppStore(s => s.setDubTaskId);
  const dubPrepStage       = useAppStore(s => s.dubPrepStage);
  const setDubPrepStage    = useAppStore(s => s.setDubPrepStage);

  const translateQuality = useAppStore(s => s.translateQuality);
  const setTranslateQuality = useAppStore(s => s.setTranslateQuality);
  const glossaryTerms = useAppStore(s => s.glossaryTerms);
  const setGlossaryTerms = useAppStore(s => s.setGlossaryTerms);
  const dualSubs = useAppStore(s => s.dualSubs);
  const burnSubs = useAppStore(s => s.burnSubs);
  const setDualSubs = useAppStore(s => s.setDualSubs);

  // ── HOÀN TÁC / LÀM LẠI + CHỈNH SỬA PHÂN ĐOẠN ──
  // Phải đặt trước useDubWorkflow vì trình xử lý generate lồng tiếng cần
  // setLastGenFingerprints để giữ đồng bộ kế hoạch tái tạo lũy tiến.
  const {
    undo, redo, editSegments,
    segmentEditField, segmentDelete, segmentRestoreOriginal,
    segmentSplit, segmentMerge,
    selectedSegIds, setSelectedSegIds,
    toggleSegSelect, selectAllSegs, clearSegSelection,
    bulkApplyToSelected, bulkDeleteSelected,
    directionSegId, openDirection, closeDirection, saveDirection,
    lastGenFingerprints, setLastGenFingerprints,
    incrementalPlan, setIncrementalPlan,
    recomputeIncremental,
  } = useSegmentEditing();

  useEffect(() => { recomputeIncremental(); }, [recomputeIncremental]);

  const {
    translateProvider, setTranslateProvider,
    showTranscript, setShowTranscript,
    previewAudios, setPreviewAudios,
    transcribeElapsed,
    handleDubUpload: _handleDubUpload, handleDubIngestUrl,
    handleDubAbort, handleDubRetryTranscribe,
    handleDubStop, handleDubGenerate,
    handleCleanupSegments, handleTranslateAll,
    handleDubImportSrt,
  } = useDubWorkflow({ loadProjects, loadProfiles, loadDubHistory, setLastGenFingerprints });

  const [dubVideoFile, setDubVideoFile] = useState(null);
  const [dubLocalBlobUrl, setDubLocalBlobUrl] = useState(null);
  const dubBlobUrlRef = useRef(null);
  useEffect(() => { dubBlobUrlRef.current = dubLocalBlobUrl; }, [dubLocalBlobUrl]);
  useEffect(() => () => {
    const urls = dubBlobUrlRef.current;
    if (urls?.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(urls.videoUrl);
    if (urls?.audioUrl?.startsWith('blob:') && urls.audioUrl !== urls.videoUrl) URL.revokeObjectURL(urls.audioUrl);
  }, []);

  const handleDubUpload = () => _handleDubUpload(dubVideoFile);

  // ═══ DỰ ÁN STUDIO (CRUD) ═══
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const activeProjectName = useAppStore(s => s.activeProjectName);
  const setActiveProject = useAppStore(s => s.setActiveProject);
  const sidebarTab    = useAppStore(s => s.sidebarTab);
  const setSidebarTab = useAppStore(s => s.setSidebarTab);

  // Chuyển sidebar sang tab hợp lệ khi view thay đổi
  useEffect(() => {
    if (availableSidebarTabs.length && !availableSidebarTabs.includes(sidebarTab)) {
      setSidebarTab(availableSidebarTabs[0]);
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const isSidebarProjectsCollapsed    = useAppStore(s => s.isSidebarProjectsCollapsed);
  const setIsSidebarProjectsCollapsed = useAppStore(s => s.setIsSidebarProjectsCollapsed);
  const isSidebarCollapsed = useAppStore(s => s.isSidebarCollapsed);
  const setIsSidebarCollapsed = useAppStore(s => s.setIsSidebarCollapsed);

  // Cổng kiểm tra lần đầu chạy — `/setup/status` báo cáo xem các mô hình HF bắt buộc có
  // trên đĩa hay không. Nếu không, chúng ta render <SetupWizard> thay vì studio chính để
  // người dùng thực sự THẤY bản tải xuống thay vì một màn hình treo 5 GB im lặng.
  //
  // Lưu ý về ứng dụng đóng gói .app: backend sidecar bị đóng băng mất vài giây để
  // import torch/torchaudio/whisper/v.v. trước khi nó có thể phục vụ /setup/status.
  // Một lần fetch duy nhất khi mount sẽ rơi vào cửa sổ đó, thất bại, và wizard
  // sẽ không bao giờ render. Vì vậy chúng ta thử lại với backoff cho đến khi có phản hồi hoặc
  // người dùng bỏ cuộc. `setupChecked` chặn việc render UI chính để chúng ta không hiển thị
  // studio chớp nhoáng trước mặt người dùng thực sự cần wizard.
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { setupStatus } = await import('./api/setup');
      // ~30 lần thử × ~1s ≈ trần 30s; đủ cho một sidecar nguội trên các ổ đĩa chậm.
      for (let attempt = 0; attempt < 30 && !cancelled; attempt++) {
        try {
          const s = await setupStatus();
          if (cancelled) return;
          setSetupNeeded(!s.models_ready);
          setSetupChecked(true);
          return;
        } catch {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      if (!cancelled) setSetupChecked(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Trình cập nhật tự động Tauri ──
  // Khi khởi động, hỏi GitHub Releases xem có bản build mới hơn không. Nếu có,
  // nhắc người dùng, tải xuống gói đã ký, khởi động lại vào phiên bản
  // mới. Chỉ chạy trong ứng dụng đóng gói .app (không phải `tauri dev`) — điểm cuối
  // cập nhật trả về 404 cho đến khi bản phát hành đã ký đầu tiên được công bố, và chúng ta
  // không muốn tiếng ồn đó trong dev console.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('__TAURI_INTERNALS__' in window)) return;
    if (import.meta.env.DEV) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ check }, { relaunch }, { ask }] = await Promise.all([
          import('@tauri-apps/plugin-updater'),
          import('@tauri-apps/plugin-process'),
          import('@tauri-apps/plugin-dialog'),
        ]);
        const update = await check();
        if (cancelled || !update) return;
        const proceed = await ask(
          t('toasts.update_available', { version: update.version }) + `\n\nCó gì mới:\n${update.body || '— xem ghi chú phát hành'}\n\nTải xuống và cài đặt ngay?`,
          { title: t('toasts.update_available_title', 'Có bản cập nhật mới'), kind: 'info' },
        );
        if (!proceed) return;
        await update.downloadAndInstall();
        await relaunch();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.debug('Kiểm tra cập nhật thất bại (không nghiêm trọng):', e);
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  // ── TÍCH HỢP NATIVE DESKTOP ──
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Ngăn chặn click chuột phải mặc định để ẩn bản chất web
    const handleContextMenu = (e) => {
      // cho phép trên input/textarea để copy/paste
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      e.preventDefault();
    };
    
    // 2. Ngăn chặn các phím tắt trình duyệt (tải lại, zoom, in)
    const handleKeyDown = (e) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (['r', 'p', '=', '-', '+'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    
    // 3. Ngăn chặn pinch-to-zoom
    const handleWheel = (e) => {
      if (e.ctrlKey) e.preventDefault();
    };
    
    // 4. Kéo và thả toàn cục để có cảm giác native mượt mà
    const handleDrop = (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      
      const isVideo = file.name.match(/\.(mp4|mov|mkv|webm|avi)$/i);
      const isAudio = file.name.match(/\.(mp3|wav|flac|m4a|ogg)$/i);
      if (isVideo || isAudio) {
        setMode('dub');
        setDubVideoFile(file);
        fileToMediaUrl(file, null).then(urls => setDubLocalBlobUrl(urls));
        setDubFilename(file.name);
        setDubStep('idle');
      }
    };
    const handleDragOver = (e) => e.preventDefault();

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragover', handleDragOver);
    
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragover', handleDragOver);
    };
  }, []);

  // ── PHÍM TẮT BÀN PHÍM ──
  useEffect(() => {
    const handler = (e) => {
      // ⌘+Enter hoặc Ctrl+Enter → Generate (Tạo)
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (mode === 'dub') {
          if (dubStep === 'editing' && dubSegments.length > 0) handleDubGenerate();
        } else {
          if (!isGenerating) handleGenerate();
        }
        return;
      }
      // ⌘+S hoặc Ctrl+S → Save project (Lưu dự án)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (mode === 'dub') saveProject();
        return;
      }
      // ⌘+Z → Undo (Hoàn tác)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      // ⌘+Shift+Z → Redo (Làm lại)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const handleNativeExport = async (e, sourceIdentifier, fallbackName, mode) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const ext = fallbackName.includes('.') ? fallbackName.split('.').pop() : 'wav';
      const destPath = await save({ defaultPath: fallbackName, filters: [{ name: 'Media', extensions: [ext] }] });
      if (!destPath) return; // Người dùng đã hủy

      await exportAction({ source_filename: sourceIdentifier, destination_path: destPath, mode });
      toast.success(t('toasts.exported', { filename: fallbackName }));
      loadExportHistory();
    } catch (err) {
      console.error(err);
      toast.error(t('toasts.export_fail', { error: err?.message || err }));
    }
  };

  const revealInFolder = async (filePath) => {
    try {
      await exportReveal({ path: filePath });
    } catch (err) {
      toast.error(t('toasts.folder_open_fail', { error: err.message }));
    }
  };

  const parseFilenameFromContentDisposition = (header) => {
    if (!header) return null;
    const utf8 = header.match(/filename\*=(?:UTF-8|utf-8)''([^;]+)/i);
    if (utf8) { try { return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, '')); } catch { /* ignore */ } }
    const plain = header.match(/filename="?([^";]+)"?/i);
    return plain ? plain[1].trim() : null;
  };

  const triggerDownload = async (url, fallbackName) => {
    const extGuess = (fallbackName.includes('.') ? fallbackName.split('.').pop() : 'bin').toLowerCase();
    const modeGuess = ['mp4','mov','mkv','webm'].includes(extGuess)
      ? 'video' : ['wav','mp3','flac'].includes(extGuess) ? 'audio' : 'file';

    // Trong Tauri, WebKit âm thầm bỏ qua việc tải xuống blob. Sử dụng native save dialog
    // + copy phía máy chủ để tệp thực sự được ghi vào đĩa tại một đường dẫn đã biết.
    if (isTauri) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const destPath = await save({
          defaultPath: fallbackName,
          filters: [{ name: modeGuess === 'video' ? 'Video' : 'Audio', extensions: [extGuess] }],
        });
        if (!destPath) return; // người dùng đã hủy
        toast.loading(t('toasts.saving', { filename: fallbackName }), { id: fallbackName });
        const sep = url.includes('?') ? '&' : '?';
        const res = await fetch(`${url}${sep}save_path=${encodeURIComponent(destPath)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || 'Lưu thất bại');
        }
        const data = await res.json();
        toast.success(t('toasts.saved', { path: data.path }), { id: fallbackName });
        try {
          await exportRecord({ filename: data.display_name || fallbackName, destination_path: data.path, mode: modeGuess });
          loadExportHistory();
        } catch (err) { console.warn('exportRecord (đường dẫn lưu Tauri) thất bại:', err); }
      } catch (err) {
        console.error(err);
        toast.error(t('toasts.save_error', { error: err.message }), { id: fallbackName });
      }
      return;
    }

    // Luồng trình duyệt: tải xuống blob tiêu chuẩn.
    try {
      toast.loading(t('toasts.processing', { filename: fallbackName }), { id: fallbackName });
      const response = await fetch(url);
      if (!response.ok) throw new Error("Tải xuống thất bại");
      const serverName = parseFilenameFromContentDisposition(response.headers.get('content-disposition'));
      const finalName = serverName || fallbackName || 'download';
      const blob = await response.blob();
      const localUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = localUrl;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(localUrl);
      toast.success(t('toasts.downloaded', { filename: finalName }), { id: fallbackName });
      try {
        await exportRecord({ filename: finalName, destination_path: `~/Downloads/${finalName}`, mode: modeGuess });
        loadExportHistory();
      } catch (err) { console.warn('exportRecord (luồng tải trình duyệt) thất bại:', err); }
    } catch (err) {
      console.error(err);
      toast.error(t('toasts.download_error', { error: err.message }), { id: fallbackName });
    }
  };

  // Chuẩn bị trước khi xuất âm thanh/video. Nếu bất kỳ phân đoạn nào đang ở
  // chất lượng nghe thử (num_step=8, từ một click "Tạo lại thay đổi"), hãy render lại chúng ở
  // chất lượng đầy đủ trước để tệp đã xuất của người dùng không mang theo các dị vật nghe thử.
  // Không thực hiện gì khi previewSegIds trống.
  const finalizeTtsBeforeExport = async () => {
    if (!previewSegIds || previewSegIds.length === 0) return;
    toast(t('toasts.upgrading_quality', { count: previewSegIds.length }), { icon: '✨' });
    await handleDubGenerate({ regenOnly: previewSegIds, preview: false });
  };

  const handleDubDownload = async () => {
    await finalizeTtsBeforeExport();
    // Xây dựng các track đã chọn từ tất cả các track đã biết
    const selected = [];
    if (exportTracks['original'] !== false) selected.push('original');
    dubTracks.forEach(t => { if (exportTracks[t] !== false) selected.push(t); });
    const tracksParam = selected.join(',');
    const burnParam = burnSubs ? `&burn_subs=1&dual=${dualSubs ? 1 : 0}` : '';
    triggerDownload(`${API}/dub/download/${dubJobId}/dubbed_video.mp4?preserve_bg=${preserveBg}&default_track=${defaultTrack}&include_tracks=${encodeURIComponent(tracksParam)}${burnParam}`, 'dubbed_video.mp4');
  };

  const handleDubAudioDownload = async () => {
    await finalizeTtsBeforeExport();
    triggerDownload(`${API}/dub/download-audio/${dubJobId}/dubbed_audio.wav?preserve_bg=${preserveBg}`, 'dubbed_audio.wav');
  };

  // Trình bao bọc xuất âm thanh chung — MP3, Clips, Stems đều cần các phân đoạn nghe thử
  // được nâng cấp trước khi mux. Xuất phụ đề (SRT/VTT) bỏ qua bước này.
  const handleAudioExport = async (url, filename) => {
    await finalizeTtsBeforeExport();
    triggerDownload(url, filename);
  };

  const resetDub = () => {
    setDubJobId(null); setDubStep('idle'); setDubSegments([]); setDubFilename('');
    setDubDuration(0); setDubError(''); setDubVideoFile(null); setDubTracks([]);
    setDubProgress({ current: 0, total: 0, text: '' }); setDubTranscript(''); setShowTranscript(false);
    setPreviewAudios({});
    setDubLocalBlobUrl(prev => {
      if (prev?.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.videoUrl);
      if (prev?.audioUrl?.startsWith('blob:') && prev.audioUrl !== prev.videoUrl) URL.revokeObjectURL(prev.audioUrl);
      return null;
    });
    setActiveProject(null);
  };

  // ═══ DỰ ÁN STUDIO (CRUD) ═══
  const saveProject = async () => {
    if (dubStep === 'idle') {
      toast.error(t('toasts.upload_first'));
      return;
    }
    const name = activeProjectName || dubFilename || `Dự án ${new Date().toLocaleString()}`;
    const statePayload = {
      name,
      video_path: dubFilename || null,
      duration: dubDuration || null,
      state: {
        dubJobId, dubFilename, dubDuration, dubSegments,
        dubLang, dubLangCode, dubInstruct, dubTracks,
        dubStep, dubTranscript, preserveBg, defaultTrack,
        speakerClones,
      },
    };
    try {
      const data = await apiSaveProject(statePayload, activeProjectId);
      setActiveProject(data.id, name);
      toast.success(activeProjectId ? t('toasts.project_saved') : t('toasts.project_created'));
      loadProjects();
    } catch (err) {
      toast.error(t('toasts.save_fail', { error: err.message }));
    }
  };

  const loadProject = async (projectOrId) => {
    const pid = typeof projectOrId === 'string' ? projectOrId : projectOrId?.id;
    try {
      const data = await apiLoadProject(pid);
      const s = data.state || {};
      setMode('dub');
      setActiveProject(data.id, data.name);
      setDubJobId(s.dubJobId || null);
      setDubFilename(s.dubFilename || data.video_path || '');
      setDubDuration(s.dubDuration || data.duration || 0);
      setDubSegments((s.dubSegments || []).map(x => ({ ...x, text_original: x.text_original || x.text || '' })));
      setDubLang(s.dubLang || 'Auto');
      setDubLangCode(s.dubLangCode || 'en');
      setDubInstruct(s.dubInstruct || '');
      setDubTracks(s.dubTracks || []);
      setDubTranscript(s.dubTranscript || '');
      setPreserveBg(s.preserveBg !== undefined ? s.preserveBg : true);
      setDefaultTrack(s.defaultTrack !== undefined ? s.defaultTrack : 'original');
      setDubStep(s.dubStep === 'done' ? 'done' : (s.dubSegments?.length ? 'editing' : 'idle'));
      // Phase 4.5 — khôi phục fingerprint của từng phân đoạn. Kế hoạch lũy tiến
      // ngay lập tức hiển thị "N phân đoạn đã thay đổi" cho bất kỳ phân đoạn nào được sửa sau
      // lần tạo cuối cùng.
      setLastGenFingerprints(s.segHashes || {});
      setSpeakerClones(s.speakerClones || {});
      toast.success(t('toasts.opened', { name: data.name }));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteProject = async (projectId, e) => {
    if (e) e.stopPropagation();
    if (!(await askConfirm(t('sidebar.delete_project_confirm', 'Xóa dự án này? Thao tác này không thể hoàn tác.')))) return;
    try {
      await apiDeleteProject(projectId);
      if (activeProjectId === projectId) {
        setActiveProject(null);
      }
      loadProjects();
      toast.success(t('toasts.project_deleted'));
    } catch (err) { toast.error(err.message); }
  };

  const restoreDubHistory = (item) => {
    try {
      if (!item.job_data) return;
      const job = JSON.parse(item.job_data);
      setMode('dub');
      setDubJobId(item.id);
      setDubFilename(job.filename || '');
      setDubDuration(job.duration || 0);
      setDubSegments((job.segments || []).map((s, i) => ({ ...s, id: s.id != null ? String(s.id) : String(i), text_original: s.text_original || s.text || '' })));
      setDubTranscript(job.full_transcript || '');
      setDubLang(item.language || 'Auto');
      setDubLangCode(item.language_code || 'und');
      setDubTracks(Object.keys(job.dubbed_tracks || {}));
      setDubStep(Object.keys(job.dubbed_tracks || {}).length > 0 ? 'done' : 'editing');
      // Phase 4.5 — seg_hashes được ghi lại cho từng phân đoạn thành công bởi
      // dub_generate.py. Tải lại một bản lồng tiếng đang tạo dở dang cho phép nút
      // "Tạo lại N thay đổi" tiếp tục ngay tại nơi xảy ra lỗi.
      setLastGenFingerprints(job.seg_hashes || {});
      // Khôi phục các hồ sơ clone người nói được trích xuất tự động để tùy chọn
      // "🎤 Từ video" trong dropdown CAST xuất hiện lại sau khi tải lại. Các dự án
      // có trước tính năng speaker-clone sẽ có map trống; nút Extract
      // Voices trong dải CAST sẽ xử lý những trường hợp đó.
      setSpeakerClones(job.speaker_clones || {});
    } catch (e) {
      console.error("Không thể khôi phục job_data", e);
    }
  };

  const restoreHistory = (item) => {
    if (item.mode) setMode(item.mode);
    if (item.text) setText(item.text);
    if (item.language) setLanguage(item.language);
    if (item.profile_id) setSelectedProfile(item.profile_id);
    
    // Chuyển sang tab studio
    setSidebarTab('projects');
    toast.success(t('toasts.restored_state'));
  };

  const deleteHistory = async (id, type) => {
    if (!(await askConfirm(t('sidebar.delete_history_confirm', 'Xóa mục lịch sử này?')))) return;
    try {
      const endpoint = type === 'dub' ? `${API}/dub/history/${id}` : `${API}/history/${id}`;
      await fetch(endpoint, { method: 'DELETE' });
      if (type === 'dub') {
        loadDubHistory();
      } else {
        loadHistory();
      }
      toast.success(t('toasts.history_deleted'));
    } catch (err) {
      toast.error(err.message);
    }
  };


  // Cổng kiểm tra lần đầu chạy: nếu /setup/status báo các mô hình chưa có trên đĩa,
  // render wizard thay vì studio chính. Tự đóng khi người dùng
  // hoàn tất tải xuống (hoặc click "Skip" nếu họ muốn dùng tạm).
  // Đồng thời chặn render cho đến khi chúng ta nhận được phản hồi từ backend ít nhất một lần
  // — cold-start của frozen sidecar mất ~5-10 s và không có cái này chúng ta sẽ
  // hiển thị studio trống trước khi wizard có cơ hội mount.
  if (!setupChecked) {
    return (
      <div style={{ zoom: uiScale }}>
        <BootstrapSplash stage={bootstrapStage} message={bootstrapMessage} />
        <Suspense fallback={null}>
          <LogsFooter />
        </Suspense>
      </div>
    );
  }
  if (setupNeeded) {
    // Render bên ngoài lưới `app-container` để wizard chiếm trọn
    // viewport thay vì bị ép vào bất kỳ ô lưới nào mà
    // studio layout dành cho cột nội dung chính.
    return (
      <div
        className="app-wizard-wrap"
        style={{ zoom: uiScale }}
      >
        {/* Dải kéo vô hình trên cùng 28 px của wizard —
            khớp với vùng traffic-light của macOS để cửa sổ có thể
            được kéo / double-click-zoom từ bất cứ đâu dọc theo phía trên. */}
        <div
          data-tauri-drag-region
          onDoubleClick={() => {
            if ('__TAURI_INTERNALS__' in window) {
              import('@tauri-apps/api/window').then(m =>
                m.getCurrentWindow().toggleMaximize()
              ).catch(() => {});
            }
          }}
          className="app-wizard-dragstrip"
        />
        <Suspense fallback={<LazyFallback />}>
          <SetupWizard onReady={() => setSetupNeeded(false)} />
        </Suspense>
        <Suspense fallback={null}>
          <LogsFooter />
        </Suspense>
      </div>
    );
  }

  // Chặn UI chính cho đến khi Rust báo cáo backend đã sẵn sàng. Trong dev web
  // (không có Tauri), hook trả về 'ready' ngay lập tức nên đây là no-op.
  if (bootstrapStage !== 'ready') {
    return <BootstrapSplash stage={bootstrapStage} message={bootstrapMessage} />;
  }

  return (
    <div
      className={[
        'app-container',
        isSidebarCollapsed ? 'sidebar-collapsed' : '',
        hideSidebar ? 'sidebar-hidden' : '',
        navRailSide === 'right' ? 'rail-right' : '',
      ].filter(Boolean).join(' ')}
      style={{ zoom: uiScale }}
    >
      {pendingTrimFile && (
        <ErrorBoundary name="audio-trimmer">
          <Suspense fallback={<LazyFallback />}>
            <AudioTrimmer
              file={pendingTrimFile}
              maxSeconds={CLONE_MAX_SECONDS}
              onCancel={() => setPendingTrimFile(null)}
              onConfirm={(trimmed) => { setPendingTrimFile(null); setRefAudio(trimmed); setSelectedProfile(null); toast.success(t('toasts.trimmed_loaded')); }}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      <Toaster position="top-center" toastOptions={{
        style: { background: 'rgba(40,40,40,0.9)', backdropFilter: 'blur(10px)', color: '#ebdbb2', border: '1px solid rgba(255,255,255,0.08)', fontSize: '0.72rem', padding: '4px 8px' },
        error: { iconTheme: { primary: '#fb4934', secondary: '#fff' } },
        success: { iconTheme: { primary: '#b8bb26', secondary: '#fff' } }
      }}/>

      <FloatingPill />

      <Header
        mode={mode} setMode={setMode}
        sysStats={sysStats} modelStatus={modelStatus}
        doubleClickMaximize={doubleClickMaximize}
        activeProjectName={activeProjectName}
        onFlushMemory={async (unloadModel) => {
          try {
            const r = await apiFlushMemory(unloadModel);
            toast.success(t('toasts.flushed', { ram: r.ram_after, vram: r.vram_after, unloaded: r.unloaded_model ? ` · ${t('header.model_unloaded', 'đã giải phóng mô hình')}` : '' }));
          } catch (e) { toast.error('Giải phóng thất bại: ' + e.message); }
        }}
      />

      <NavRail mode={mode} setMode={setMode} side={navRailSide} onFlipSide={flipNavRailSide} />

      <div className="main-content">

        {/* ═══ TAB CÀI ĐẶT (SETTINGS) ═══ */}
        {mode === 'settings' ? (
          <ErrorBoundary name="settings">
            <Suspense fallback={<LazyFallback />}>
              <Settings />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'voice' ? (
          <ErrorBoundary name="voice-profile">
            <Suspense fallback={<LazyFallback />}>
              <VoiceProfile
                voiceId={activeVoiceId}
                onBack={closeVoiceProfile}
                onOpenProject={(id) => { loadProject(id); }}
                onDeleted={() => {
                  loadProfiles();
                  closeVoiceProfile();
                }}
              />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'queue' ? (
          <ErrorBoundary name="batch-queue">
            <Suspense fallback={<LazyFallback />}>
              <BatchQueue onBack={() => setMode('launchpad')} />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'tools' ? (
          <ErrorBoundary name="tools">
            <Suspense fallback={<LazyFallback />}>
              <ToolsPage onBack={() => setMode('launchpad')} />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'projects' ? (
          <ErrorBoundary name="projects">
            <Suspense fallback={<LazyFallback />}>
              <ProjectsPage
                studioProjects={studioProjects}
                profiles={profiles}
                history={history}
                exportHistory={exportHistory}
                onOpenDub={(id) => { loadProject(id); setMode('dub'); }}
                onOpenProfile={(id) => { openVoiceProfile(id); }}
                onRevealExport={(path) => { exportReveal({ path }).catch(() => {}); }}
              />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'gallery' ? (
          <ErrorBoundary name="gallery">
            <Suspense fallback={<LazyFallback />}>
              <VoiceGallery />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'transcriptions' ? (
          <ErrorBoundary name="transcriptions">
            <Suspense fallback={<LazyFallback />}>
              <TranscriptionsPage />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'stories' ? (
          <ErrorBoundary name="stories">
            <Suspense fallback={<LazyFallback />}>
              <StoriesEditor profiles={profiles} />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'donate' ? (
          <ErrorBoundary name="donate">
            <Suspense fallback={<LazyFallback />}>
              <DonatePage onBack={() => setMode('launchpad')} onEnterprise={() => setMode('enterprise')} />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'enterprise' ? (
          <ErrorBoundary name="enterprise">
            <Suspense fallback={<LazyFallback />}>
              <EnterprisePage onBack={() => setMode('launchpad')} />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'launchpad' ? (
          <ErrorBoundary name="launchpad">
          <Suspense fallback={<LazyFallback />}>
            <Launchpad
              profiles={profiles}
              studioProjects={studioProjects}
              dubHistory={dubHistory}
              setMode={setMode}
              setIsCompareModalOpen={setIsCompareModalOpen}
              handleSelectProfile={handleSelectProfile}
              loadProject={loadProject}
            />
          </Suspense>
          </ErrorBoundary>
        ) : mode === 'dub' ? (
          <ErrorBoundary name="dub">
          <Suspense fallback={<LazyFallback />}>
            <DubTab
              // Chỉ các trạng thái không thể tuần tự hóa / cục bộ — tất cả các trường pipeline hiện
              // chảy qua Zustand store.
              dubVideoFile={dubVideoFile}
              dubLocalBlobUrl={dubLocalBlobUrl}
              transcribeElapsed={transcribeElapsed}
              translateProvider={translateProvider} setTranslateProvider={setTranslateProvider}
              onGlossaryChange={setGlossaryTerms}
              showTranscript={showTranscript} setShowTranscript={setShowTranscript}
              profiles={profiles}
              segmentPreviewLoading={segmentPreviewLoading}
              selectedSegIds={selectedSegIds}
              setDubVideoFile={setDubVideoFile}
              setDubLocalBlobUrl={setDubLocalBlobUrl}
              // Các trình xử lý — đóng gói scope của App.jsx nên vẫn được truyền qua prop.
              handleDubAbort={handleDubAbort} handleDubUpload={handleDubUpload} handleDubIngestUrl={handleDubIngestUrl}
              handleDubRetryTranscribe={handleDubRetryTranscribe}
              handleDubStop={handleDubStop} handleDubGenerate={handleDubGenerate}
              handleDubDownload={handleDubDownload} handleDubAudioDownload={handleDubAudioDownload}
              handleAudioExport={handleAudioExport}
              speakerClones={speakerClones}
              handleSegmentPreview={handleSegmentPreview}
              onDirectSegment={openDirection}
              incrementalPlan={incrementalPlan}
              handleTranslateAll={handleTranslateAll}
              handleCleanupSegments={handleCleanupSegments}
              handleDubImportSrt={handleDubImportSrt}
              triggerDownload={triggerDownload}
              fileToMediaUrl={fileToMediaUrl}
              editSegments={editSegments}
              saveProject={saveProject} resetDub={resetDub}
              segmentEditField={segmentEditField} segmentDelete={segmentDelete}
              segmentRestoreOriginal={segmentRestoreOriginal}
              segmentSplit={segmentSplit} segmentMerge={segmentMerge}
              toggleSegSelect={toggleSegSelect}
              selectAllSegs={selectAllSegs} clearSegSelection={clearSegSelection}
              bulkApplyToSelected={bulkApplyToSelected}
              bulkDeleteSelected={bulkDeleteSelected}
            />
          </Suspense>
          </ErrorBoundary>
        ) : (
          <ErrorBoundary name="clone-design">
          <Suspense fallback={<LazyFallback />}>
            <CloneDesignTab
              mode={mode}
              textAreaRef={textAreaRef}
              text={text} setText={setText}
              language={language} setLanguage={setLanguage}
              steps={steps} setSteps={setSteps}
              cfg={cfg} setCfg={setCfg}
              speed={speed} setSpeed={setSpeed}
              tShift={tShift} setTShift={setTShift}
              posTemp={posTemp} setPosTemp={setPosTemp}
              classTemp={classTemp} setClassTemp={setClassTemp}
              layerPenalty={layerPenalty} setLayerPenalty={setLayerPenalty}
              duration={duration} setDuration={setDuration}
              denoise={denoise} setDenoise={setDenoise}
              postprocess={postprocess} setPostprocess={setPostprocess}
              showOverrides={showOverrides} setShowOverrides={setShowOverrides}
              isSidebarCollapsed={isSidebarCollapsed} setIsSidebarCollapsed={setIsSidebarCollapsed}
              profiles={profiles}
              selectedProfile={selectedProfile} setSelectedProfile={setSelectedProfile}
              refAudio={refAudio}
              refText={refText} setRefText={setRefText}
              instruct={instruct} setInstruct={setInstruct}
              profileName={profileName} setProfileName={setProfileName}
              showSaveProfile={showSaveProfile} setShowSaveProfile={setShowSaveProfile}
              isRecording={isRecording} isCleaning={isCleaning} recordingTime={recordingTime}
              vdStates={vdStates} setVdStates={setVdStates}
              isGenerating={isGenerating} generationTime={generationTime}
              applyPreset={applyPreset} insertTag={insertTag}
              handleSelectProfile={handleSelectProfile}
              handleDeleteProfile={handleDeleteProfile}
              handleSaveProfile={handleSaveProfile}
              handleGenerate={handleGenerate}
              startRecording={startRecording} stopRecording={stopRecording}
              ingestRefAudio={ingestRefAudio}
            />
          </Suspense>
          </ErrorBoundary>
        )}
      </div>

      {/* ── SIDEBAR (THANH BÊN) ── */}
      <Suspense fallback={<LazyFallback />}>
        <Sidebar
          availableTabs={availableSidebarTabs}
          isSidebarProjectsCollapsed={isSidebarProjectsCollapsed}
          setIsSidebarProjectsCollapsed={setIsSidebarProjectsCollapsed}
          sidebarTab={sidebarTab} setSidebarTab={setSidebarTab}
          studioProjects={studioProjects}
          profiles={profiles}
          history={history}
          dubHistory={dubHistory}
          exportHistory={exportHistory}
          dubVideoFile={dubVideoFile}
          selectedProfile={selectedProfile}
          previewLoading={previewLoading}
          saveProject={saveProject}
          loadProject={loadProject}
          deleteProject={deleteProject}
          handleSelectProfile={handleSelectProfile}
          handleDeleteProfile={handleDeleteProfile}
          handleOpenVoiceProfile={openVoiceProfile}
          handleUnlockProfile={handleUnlockProfile}
          handleLockProfile={handleLockProfile}
          handlePreviewVoice={handlePreviewVoice}
          onOpenVoicePreview={(profileId) => {
            setVoicePreviewProfileId(profileId || '');
            setIsVoicePreviewOpen(true);
          }}
          restoreHistory={restoreHistory}
          restoreDubHistory={restoreDubHistory}
          handleSaveHistoryAsProfile={handleSaveHistoryAsProfile}
          handleNativeExport={handleNativeExport}
          revealInFolder={revealInFolder}
          deleteHistory={deleteHistory}
          loadHistory={loadHistory}
          loadDubHistory={loadDubHistory}
        />
      </Suspense>

      {/* ═══ DIALOG CHỈ ĐẠO (Phase 4.2) ═══ */}
      <DirectionDialog
        open={!!directionSegId}
        seg={directionSegId ? dubSegments.find(s => s.id === directionSegId) : null}
        onSave={saveDirection}
        onClose={closeDirection}
      />

      {/* ═══ MODAL SO SÁNH GIỌNG NÓI A/B ═══ */}
      {isCompareModalOpen && (
        <Suspense fallback={<LazyFallback />}>
          <CompareModal
            open={isCompareModalOpen}
            onClose={() => setIsCompareModalOpen(false)}
            profiles={profiles}
            compareText={compareText} setCompareText={setCompareText}
            compareVoiceA={compareVoiceA} setCompareVoiceA={setCompareVoiceA}
            compareVoiceB={compareVoiceB} setCompareVoiceB={setCompareVoiceB}
            compareResultA={compareResultA} setCompareResultA={setCompareResultA}
            compareResultB={compareResultB} setCompareResultB={setCompareResultB}
            compareProgress={compareProgress} setCompareProgress={setCompareProgress}
            isComparing={isComparing} setIsComparing={setIsComparing}
            steps={steps} cfg={cfg} speed={speed} denoise={denoise} postprocess={postprocess}
            fileToMediaUrl={fileToMediaUrl}
            loadHistory={loadHistory}
          />
        </Suspense>
      )}

      {/* ═══ BẢNG TRA PHÍM TẮT ( ? ) ═══ */}
      {showCheatsheet && (
        <Suspense fallback={null}>
          <KeyboardCheatsheet open={showCheatsheet} onClose={() => setShowCheatsheet(false)} />
        </Suspense>
      )}

      {/* ═══ THẺ NỔI XEM TRƯỚC GIỌNG NÓI ═══ */}
      {isVoicePreviewOpen && (
        <Suspense fallback={null}>
          <VoicePreview
            open={isVoicePreviewOpen}
            onClose={() => setIsVoicePreviewOpen(false)}
            profiles={profiles}
            initialProfileId={voicePreviewProfileId}
            fileToMediaUrl={fileToMediaUrl}
          />
        </Suspense>
      )}

      {/* ═══ BẢNG NHẬT KÝ PHÍA DƯỚI (kiểu VSCode) ═══ */}
      <Suspense fallback={null}>
        <LogsFooter />
      </Suspense>

    </div>
  );
}

export default App;
