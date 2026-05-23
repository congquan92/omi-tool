import React, { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import {
  Scale, Fingerprint, Wand2, Film, Lock,
} from 'lucide-react';
import { API } from '../api/client';
import ReadinessChecklist from '../components/ReadinessChecklist';

function DubThumb({ jobId, fallback }) {
  const [failed, setFailed] = useState(false);
  if (!jobId || failed) return fallback;
  return (
    <img
      src={`${API}/dub/thumb/${jobId}`}
      alt=""
      onError={() => setFailed(true)}
      loading="lazy"
      className="lp-dub-thumb"
    />
  );
}

// Squiggle đã được thay thế bằng span .lp-hero__sweep — một đường nhấn hoạt họa CSS thuần
// dưới thẻ H1. Ít tĩnh hơn, không phụ thuộc vào SVG.

/**
 * ActionCard — ba thẻ lớn trên Launchpad. Đọc accent từ một biến `--card-hue` duy nhất
 * để CSS trích xuất background / border / glow / spotlight từ một mã màu hex.
 * Spotlight theo dấu con trỏ: các sự kiện pointer đặt --mx/--my để `.lp-glow-layer`
 * có thể vẽ một dải gradient tròn tại vị trí con trỏ. Vòng hơi thở vĩnh cửu nằm trên
 * `.lp-glow-layer::after` và đập mãi mãi dù thẻ có được hover hay không.
 */
function ActionCard({ hue, Icon, title, accent, count, onClick, children }) {
  const handleMouseMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <button
      type="button"
      className="lp-action-card lp-animate lp-glow-card"
      onClick={onClick}
      onMouseMove={handleMouseMove}
      style={{ '--card-hue': hue }}
    >
      <span className="lp-glow-layer" aria-hidden="true" />
      {count > 0 && <span className="card-count">{count}</span>}
      <div className="card-icon">
        <Icon size={18} color={hue} />
      </div>
      <h3>
        {title} <span className="lp-action-card__emoji" aria-hidden="true">{accent}</span>
      </h3>
      <p className="card-desc">{children}</p>
    </button>
  );
}

export default function Launchpad({
  profiles, studioProjects, dubHistory,
  setMode, setIsCompareModalOpen, handleSelectProfile, loadProject,
}) {
  const { t } = useTranslation();
  const cloneProfiles = profiles.filter(p => !p.instruct);
  const designProfiles = profiles.filter(p => !!p.instruct);
  const demoProfile = profiles.find(p => p.id === 'demo0001');

  return (
    <div className="launchpad">
      {/* Nền ambient — aurora chrome-accent trôi dạt mãi mãi. Nằm sau mọi thứ ở z=0,
          đóng góp vào "eternal glow" mà người dùng yêu cầu mà không cần vẽ lên bất kỳ bề mặt nào. */}
      <div className="lp-aurora" aria-hidden="true">
        <span className="lp-aurora__blob lp-aurora__blob--pink" />
        <span className="lp-aurora__blob lp-aurora__blob--green" />
        <span className="lp-aurora__blob lp-aurora__blob--amber" />
      </div>

      {/* Hero */}
      <div className="lp-hero">
        <div className="lp-hero__row">
          <div className="lp-hero__col">
            <div className="lp-hero__kicker-row">
              <div className="lp-hero__wave-group">
                {[10, 14, 8, 16, 12, 14, 9, 12].map((h, i) => (
                  <span
                    key={i}
                    className="lp-wave-bar"
                    style={{
                      // Độ lệch hoạt ảnh trên mỗi thanh + thời lượng riêng biệt tạo ra
                      // một nhịp thở không bao giờ trùng lặp thay vì sự bật nảy cứng nhắc
                      // như phiên bản cũ.
                      '--bar-h': `${h}px`,
                      '--bar-delay': `${i * 0.17}s`,
                      '--bar-dur':   `${1.8 + (i % 3) * 0.4}s`,
                    }}
                  />
                ))}
              </div>
              <span className="lp-kicker">{t('launchpad.greeting')}</span>
            </div>
            <h1 className="lp-hero__title">
              <span className="lp-hero__halo" aria-hidden="true" />
              <Trans i18nKey="launchpad.hero_title">
                Tạo ra những giọng nói <em>giống hệt bạn</em>.
              </Trans>
              <span className="lp-hero__sweep" aria-hidden="true" />
            </h1>
            <p>
              <Trans i18nKey="launchpad.hero_desc" values={{ count: t('common.languages_count') }}>
                Clone một giọng nói, thiết kế giọng mới, hoặc lồng tiếng video sang bất kỳ ngôn ngữ nào trong số <span className="lp-pill">{{count: t('common.languages_count')}}</span>. Dành cho những nhà sáng tạo chú trọng âm thanh.
              </Trans>
            </p>
          </div>
          {/* A/B Compare là so sánh giọng nói song song — chỉ hữu ích khi người dùng
              có ít nhất hai hồ sơ để so sánh. Trong một bản cài đặt mới (hoặc cho người dùng lần đầu)
              nút này chỉ là nhiễu giao diện mở ra một modal trống, vì vậy chúng ta giới hạn nó. */}
          {profiles.length >= 2 && (
            <button
              onClick={() => setIsCompareModalOpen(true)}
              className="lp-ab-compare"
              title={t('launchpad.ab_compare_hint')}
            >
              <Scale size={12} /> {t('launchpad.ab_compare')}
            </button>
          )}
        </div>

      </div>

      {/* Các thẻ hành động */}
      <div className="lp-actions">
        <ActionCard hue="#d3869b" Icon={Fingerprint} title={t('launchpad.clone_title')} accent="✨" count={cloneProfiles.length} onClick={() => setMode('clone')}>
          {t('launchpad.clone_desc')}
        </ActionCard>
        <ActionCard hue="#8ec07c" Icon={Wand2} title={t('launchpad.design_title')} accent="🧪" count={designProfiles.length} onClick={() => setMode('design')}>
          {t('launchpad.design_desc')}
        </ActionCard>
        <ActionCard hue="#fe8019" Icon={Film} title={t('launchpad.dub_title')} accent="🎬" count={studioProjects.length} onClick={() => setMode('dub')}>
          {t('launchpad.dub_desc')}
        </ActionCard>
      </div>

      {/* Demo profile callout */}
      {demoProfile && profiles.length === 1 && studioProjects.length === 0 && (
        <div className="lp-demo-callout">
          <span className="lp-demo-callout__icon">👋</span>
          <span>{t('launchpad.demo_callout')}</span>
          <button
            className="lp-demo-callout__btn"
            onClick={() => { setMode('clone'); handleSelectProfile(demoProfile); }}
          >
            {t('common.try_it')}
          </button>
        </div>
      )}

      {/* Các dự án gần đây */}
      {(profiles.length > 0 || studioProjects.length > 0) && (
        <div className="lp-section">
          <div className="lp-section__grid">
            {/* Giọng đã Clone */}
            {cloneProfiles.length > 0 && (
              <div>
                <div className="lp-section-title"><Fingerprint size={12} color="#d3869b" /> {t('launchpad.cloned_voices')}</div>
                <div className="lp-col">
                  {cloneProfiles.map(p => (
                    <div key={p.id} className="lp-project-card">
                      <div className="proj-icon lp-proj-icon--clone"><Fingerprint size={14} color="#d3869b" /></div>
                      <div className="proj-info">
                        <div className="proj-name">{p.name}</div>
                        <div className="proj-meta">{p.ref_audio_path}</div>
                      </div>
                      <button className="proj-action" onClick={() => { setMode('clone'); handleSelectProfile(p); }}>{t('common.open')}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Giọng đã Thiết kế */}
            {designProfiles.length > 0 && (
              <div>
                <div className="lp-section-title"><Wand2 size={12} color="#8ec07c" /> {t('launchpad.designed_voices')}</div>
                <div className="lp-col">
                  {designProfiles.map(p => (
                    <div key={p.id} className="lp-project-card">
                      <div className={`proj-icon ${p.is_locked ? 'lp-proj-icon--locked' : 'lp-proj-icon--design'}`}>
                        {p.is_locked ? <Lock size={14} color="#b8bb26" /> : <Wand2 size={14} color="#8ec07c" />}
                      </div>
                      <div className="proj-info">
                        <div className="proj-name">{p.name}</div>
                        <div className="proj-meta lp-proj-meta--italic">{p.instruct}</div>
                      </div>
                      {p.is_locked && <span className="lp-locked-badge">{t('launchpad.locked')}</span>}
                      <button className="proj-action" onClick={() => { setMode('design'); handleSelectProfile(p); }}>{t('common.open')}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dự án Lồng tiếng */}
            {studioProjects.length > 0 && (
              <div>
                <div className="lp-section-title"><Film size={12} color="#fe8019" /> {t('launchpad.dubbing_projects')}</div>
                <div className="lp-col">
                  {studioProjects.map(proj => (
                    <div key={proj.id} className="lp-project-card">
                      <div className="proj-icon lp-proj-icon--dub">
                        <DubThumb
                          jobId={proj.state?.dubJobId || proj.id}
                          fallback={<Film size={14} color="#fe8019" />}
                        />
                      </div>
                      <div className="proj-info">
                        <div className="proj-name">{proj.name}</div>
                        <div className="proj-meta">{proj.video_path || t('common.audio_only')}</div>
                      </div>
                      <button className="proj-action" onClick={() => { setMode('dub'); loadProject(proj.id); }}>{t('common.open')}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trạng thái trống */}
      {profiles.length === 0 && studioProjects.length === 0 && (
        <div className="lp-empty">
          <div className="lp-empty__inner">
            <div className="lp-empty__bars">
              {[8, 14, 22, 18, 26, 14, 20, 10, 16].map((h, i) => (
                <span
                  key={i}
                  className="lp-wave-bar"
                  style={{
                    height: h, background: '#665c54', animationDelay: `${i * 0.12}s`,
                  }}
                />
              ))}
            </div>
            <p className="lp-empty__hint">
              {t('launchpad.empty_hint')}
            </p>
          </div>
          <ReadinessChecklist />
        </div>
      )}

      {/* Hiển thị checklist cùng với các dự án hiện có, nhưng chỉ khi có vấn đề tồn tại */}
      {(profiles.length > 0 || studioProjects.length > 0) && (
        <ReadinessChecklist compact />
      )}
    </div>
  );
}
