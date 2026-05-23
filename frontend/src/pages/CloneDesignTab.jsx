import React, { useState, useEffect } from 'react';
import {
  PanelLeftOpen, PanelLeftClose, Command, Globe, SlidersHorizontal, Volume2, User,
  UploadCloud, Square, Mic, Save, UserSquare2, Settings2, ChevronUp, ChevronDown,
  Sparkles, Play, Trash2, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import SearchableSelect from '../components/SearchableSelect';
import ALL_LANGUAGES from '../languages.json';
import { POPULAR_LANGS, PRESETS, TAGS, CATEGORIES } from '../utils/constants';
import { Button, Input, Slider, Progress } from '../ui';
import { API } from '../api/client';
import './CloneDesignTab.css';

export default function CloneDesignTab(props) {
  const {
    mode,
    textAreaRef,
    text, setText,
    language, setLanguage,
    steps, setSteps,
    cfg, setCfg,
    speed, setSpeed,
    tShift, setTShift,
    posTemp, setPosTemp,
    classTemp, setClassTemp,
    layerPenalty, setLayerPenalty,
    duration, setDuration,
    denoise, setDenoise,
    postprocess, setPostprocess,
    showOverrides, setShowOverrides,
    isSidebarCollapsed, setIsSidebarCollapsed,
    profiles,
    selectedProfile, setSelectedProfile,
    refAudio,
    refText, setRefText,
    instruct, setInstruct,
    profileName, setProfileName,
    showSaveProfile, setShowSaveProfile,
    isRecording, isCleaning, recordingTime,
    vdStates, setVdStates,
    isGenerating, generationTime,
    applyPreset, insertTag,
    handleSelectProfile, handleDeleteProfile,
    handleSaveProfile, handleGenerate,
    startRecording, stopRecording,
    ingestRefAudio,
  } = props;

  const { t } = useTranslation();
  const [activePersonality, setActivePersonality] = useState('');

  // Lấy các thiết lập cá tính từ backend
  const { data: personalities = [] } = useQuery({
    queryKey: ['personalities'],
    queryFn: () => fetch(`${API}/personalities`).then(r => r.json()),
    staleTime: Infinity,
  });

  const applyPersonality = (p) => {
    if (activePersonality === p.id) {
      setActivePersonality('');
      return;
    }
    setActivePersonality(p.id);
    setInstruct(p.instruct);
  };

  return (
    <div className="clone-split-grid">

      {/* ═══ CỘT TRÁI: prompt + ngôn ngữ/số bước ═══ */}
      <div className="studio-column">
        <div className="studio-panel">
          <div className="label-row label-row--center">
            <Button
              variant="icon"
              iconSize="sm"
              active={isSidebarCollapsed}
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              title={t('menu.sidebar_toggle', 'Bật/Tắt Sidebar')}
              className="label-row__kicker"
            >
              {isSidebarCollapsed ? <PanelLeftOpen size={12} /> : <PanelLeftClose size={12} />}
            </Button>
            <Command className="label-icon" size={14} /> {t('clone.prompt')}
          </div>
          {mode === 'design' && (
            <div className="preset-grid">
              {PRESETS.map(p => (
                <button key={p.id} className="preset-btn" onClick={() => applyPreset(p)}>{p.name}</button>
              ))}
            </div>
          )}
          <textarea
            ref={textAreaRef}
            className="input-base clone-text-area"
            placeholder={mode === 'clone' ? t('clone.placeholder_clone') : t('clone.placeholder_design')}
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <div className="tags-container">
            {TAGS.map(tag => <button key={tag} className="tag-btn" onClick={() => insertTag(tag)}>{tag}</button>)}
            <button
              className="tag-btn clone-auto-extract-btn"
              onClick={() => insertTag('[B EY1 S]')}
            >
              [CMU]
            </button>
          </div>
        </div>

        <div className="studio-panel clone-panel--overflow-visible">
          <div className="grid-2">
            <div>
              <div className="label-row"><Globe className="label-icon" size={14} /> {t('clone.language')} ({ALL_LANGUAGES.length - 1})</div>
              <SearchableSelect
                value={language}
                options={ALL_LANGUAGES}
                popular={POPULAR_LANGS}
                recentsKey="omnivoice.recents.genLang"
                onChange={setLanguage}
              />
            </div>
            <div>
              <div className="label-row label-row--spread">
                <span className="label-row label-row--flush">
                  <SlidersHorizontal className="label-icon" size={14} /> {t('clone.steps')}
                </span>
                <span className="val-bubble">{steps}</span>
              </div>
              <input type="range" min="8" max="64" value={steps} onChange={e => setSteps(Number(e.target.value))} />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ CỘT PHẢI: nguồn giọng nói + ghi đè/tổng hợp ═══ */}
      <div className="studio-column">
        <div className="studio-panel">
        {mode === 'clone' ? (
          <div>
            <div className="label-row"><Volume2 className="label-icon" size={14} /> {t('clone.voice_source')}</div>

            {/* ── HỒ SƠ GIỌNG NÓI ── */}
            {profiles.length > 0 && (
              <div className="clone-profile-block">
                <div className="label-row label-row--sm"><User size={12} /> {t('clone.saved_profiles')}</div>
                <div className="preset-grid">
                  {profiles.map(p => (
                    <div
                      key={p.id}
                      className={`preset-btn clone-profile-card ${selectedProfile === p.id ? 'profile-active' : ''}`}
                      onClick={() => handleSelectProfile(p)}
                    >
                      <User size={10} /> {p.name}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteProfile(p.id); }}
                        className="clone-profile-delete"
                        aria-label="Xóa hồ sơ"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!selectedProfile && (
              <div className="clone-drop-row">
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg"
                  onChange={e => { const f = e.target.files[0]; ingestRefAudio(f); e.target.value = ''; }}
                  className="dub-hidden-file"
                  id="audio-upload"
                />
                <label
                  htmlFor="audio-upload"
                  className="file-drag clone-drop-zone"
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('is-dragging'); }}
                  onDragLeave={e => { e.currentTarget.classList.remove('is-dragging'); }}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('is-dragging');
                    const file = e.dataTransfer.files[0];
                    const okType = file && (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|flac|ogg|aac|webm)$/i.test(file.name));
                    if (okType) ingestRefAudio(file);
                  }}
                >
                  <UploadCloud color="#a89984" size={18} />
                  <p>{refAudio ? <span className="clone-drop-filename">{refAudio.name}</span> : t('clone.drop_hint')}</p>
                </label>

                <MicButton
                  isCleaning={isCleaning}
                  isRecording={isRecording}
                  recordingTime={recordingTime}
                  onStart={startRecording}
                  onStop={stopRecording}
                />
              </div>
            )}

            {selectedProfile && (
              <div className="clone-profile-banner">
                <span className="clone-profile-banner__label">
                  {t('clone.using_profile')}: {profiles.find(p => p.id === selectedProfile)?.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedProfile(null)}
                  leading={<X size={11} />}
                >
                  {t('sidebar.clear')}
                </Button>
              </div>
            )}

            <div className="grid-2 grid-2--indent">
              <div>
                <div className="label-row">{t('clone.transcript')}</div>
                <input type="text" className="input-base" value={refText} onChange={e => setRefText(e.target.value)} placeholder={`(${t('dub.optional')})`} />
              </div>
              <div>
                <div className="label-row">{t('clone.style')}</div>
                <input type="text" className="input-base" value={instruct} onChange={e => setInstruct(e.target.value)} placeholder="vd: thì thầm" />
              </div>
            </div>

            {/* Lưu thành hồ sơ */}
            {refAudio && !selectedProfile && (
              <div className="clone-save-profile">
                {!showSaveProfile ? (
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => setShowSaveProfile(true)}
                    leading={<Save size={12} />}
                  >
                    {t('clone.save_profile')}
                  </Button>
                ) : (
                  <div className="clone-save-profile__row">
                    <Input
                      size="sm"
                      placeholder={t('clone.profile_name')}
                      value={profileName}
                      onChange={e => setProfileName(e.target.value)}
                    />
                    <Button variant="subtle" size="sm" onClick={handleSaveProfile}>{t('common.save')}</Button>
                    <Button variant="ghost"  size="sm" onClick={() => setShowSaveProfile(false)}>{t('common.cancel')}</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="label-row"><UserSquare2 className="label-icon" size={14} /> {t('voice.personality')}</div>

            {/* Thiết lập cá tính */}
            {personalities.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="personality-label">{t('voice.pick_personality')}</div>
                <div className="personality-strip">
                  {personalities.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className={`personality-chip ${activePersonality === p.id ? 'active' : ''}`}
                      onClick={() => applyPersonality(p)}
                    >
                      <span className="personality-chip__icon">{p.icon}</span>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="clone-sliders-col">
              {Object.entries(CATEGORIES).map(([key, options]) => {
                const many = options.length > 6;
                return (
                  <div key={key}>
                    <div className="label-row label-row--sm">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                      <span className="clone-slider-kicker">
                        {vdStates[key] === 'Auto' ? '· auto' : `· ${vdStates[key]}`}
                      </span>
                    </div>
                    {many ? (
                      <select
                        className="input-base"
                        value={vdStates[key]}
                        onChange={e => setVdStates({ ...vdStates, [key]: e.target.value })}
                      >
                        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <div className="chip-group">
                        {options.map(opt => (
                          <button
                            key={opt}
                            type="button"
                            className={`chip ${vdStates[key] === opt ? 'active' : ''}`}
                            onClick={() => setVdStates({ ...vdStates, [key]: opt })}
                          >
                            {opt === 'Auto' ? '✨ Auto' : opt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        </div>

        <div className="studio-panel clone-panel--overflow-visible">
        <div className="override-toggle" onClick={() => setShowOverrides(!showOverrides)}>
          <span><Settings2 size={14} className="clone-icon-inline" /> {t('clone.production_overrides')}</span>
          {showOverrides ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
        {showOverrides && (
          <div className="override-content">
            <div className="grid-4">
              <div>
                <div className="label-row label-row--spread"><span>CFG</span><span className="val-bubble">{cfg}</span></div>
                <input type="range" min="1.0" max="4.0" step="0.1" value={cfg} onChange={e => setCfg(Number(e.target.value))} />
              </div>
              <div>
                <div className="label-row label-row--spread"><span>Speed</span><span className="val-bubble">{speed}x</span></div>
                <input type="range" min="0.5" max="2.0" step="0.1" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
              </div>
              <div>
                <div className="label-row label-row--spread"><span>t_shift</span><span className="val-bubble">{tShift}</span></div>
                <input type="range" min="0" max="1.0" step="0.05" value={tShift} onChange={e => setTShift(Number(e.target.value))} />
              </div>
              <div>
                <div className="label-row label-row--spread"><span>Pos Temp</span><span className="val-bubble">{posTemp}</span></div>
                <input type="range" min="0" max="10" step="0.5" value={posTemp} onChange={e => setPosTemp(Number(e.target.value))} />
              </div>
              <div>
                <div className="label-row label-row--spread"><span>Class Temp</span><span className="val-bubble">{classTemp}</span></div>
                <input type="range" min="0" max="2" step="0.1" value={classTemp} onChange={e => setClassTemp(Number(e.target.value))} />
              </div>
              <div>
                <div className="label-row label-row--spread"><span>Layer Pen</span><span className="val-bubble">{layerPenalty}</span></div>
                <input type="range" min="0" max="10" step="0.5" value={layerPenalty} onChange={e => setLayerPenalty(Number(e.target.value))} />
              </div>
              <div>
                <div className="label-row"><span>{t('clone.duration')}</span></div>
                <input type="text" className="input-base clone-duration-input" value={duration} onChange={e => setDuration(e.target.value)} placeholder="Auto" />
              </div>
              <div className="clone-prod-col">
                <label className="clone-prod-check">
                  <input type="checkbox" checked={denoise} onChange={e => setDenoise(e.target.checked)} /> {t('clone.denoise')}
                </label>
                <label className="clone-prod-check">
                  <input type="checkbox" checked={postprocess} onChange={e => setPostprocess(e.target.checked)} /> {t('clone.postprocess')}
                </label>
              </div>
            </div>
          </div>
        )}

        <Button
          variant="primary"
          block
          loading={isGenerating}
          onClick={handleGenerate}
          leading={!isGenerating && <Play size={14} />}
          className="clone-footer-cta"
        >
          {isGenerating ? `${t('clone.synthesizing')} (${generationTime}s)` : t('clone.synthesize')}
        </Button>
        {isGenerating && (
          <Progress
            value={Math.min((generationTime / 8) * 100, 95)}
            tone="brand"
            size="sm"
            className="clone-footer-cta"
          />
        )}
        </div>
      </div>
    </div>
  );
}

function MicButton({ isCleaning, isRecording, recordingTime, onStart, onStop }) {
  const { t } = useTranslation();
  if (isCleaning) {
    return (
      <div className="mic-btn mic-btn--cleaning">
        <Sparkles size={18} className="spinner" />
        <span>{t('clone.cleaning')}</span>
      </div>
    );
  }
  if (isRecording) {
    return (
      <button type="button" onClick={onStop} className="mic-btn mic-btn--recording">
        <Square size={18} fill="currentColor" />
        <span>{recordingTime}s</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={onStart} className="mic-btn mic-btn--idle" title={t('clone.record_hint')}>
      <Mic size={18} />
      <span>{t('clone.record')}</span>
    </button>
  );
}
