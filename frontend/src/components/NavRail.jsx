import React from 'react';
import {
  Globe, Fingerprint, Wand2, Film, FolderOpen, Settings2, ArrowLeftRight,
  Library, FileText, BookOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function NavRail({ mode, setMode, side = 'left', onFlipSide }) {
  const { t } = useTranslation();

  const ITEMS = [
    { id: 'launchpad', label: t('menu.launchpad'), Icon: Globe,       accent: '#f3a5b6' },
    { id: 'clone',     label: t('sidebar.clone'),     Icon: Fingerprint, accent: '#d3869b' },
    { id: 'design',    label: t('sidebar.design'),    Icon: Wand2,       accent: '#8ec07c' },
    { id: 'dub',       label: t('sidebar.dub'),       Icon: Film,        accent: '#fe8019' },
    { id: 'stories',   label: t('menu.stories', 'Stories'), Icon: BookOpen,    accent: '#fabd2f' },
    { id: 'gallery',   label: t('menu.gallery'),      Icon: Library,     accent: '#b8bb26' },
    { id: 'transcriptions', label: t('menu.transcriptions'), Icon: FileText, accent: '#d3869b' },
    { id: 'projects',  label: t('menu.projects'),     Icon: FolderOpen,  accent: '#83a598' },
  ];
  const FOOTER_ITEMS = [
    { id: 'settings', label: t('menu.settings'), Icon: Settings2, accent: '#fabd2f' },
  ];

  return (
    <aside className={`nav-rail rail-${side}`}>
      <div className="rail-top">
        {ITEMS.map((it) => (
          <RailBtn key={it.id} {...it} active={mode === it.id} onClick={() => setMode(it.id)} />
        ))}
      </div>
      <div className="rail-bottom">
        {FOOTER_ITEMS.map((it) => (
          <RailBtn key={it.id} {...it} active={mode === it.id} onClick={() => setMode(it.id)} />
        ))}
        <button
          onClick={onFlipSide}
          title={t('menu.flip_rail', { side: side === 'left' ? t('common.right', 'phải') : t('common.left', 'trái') })}
          aria-label="Flip rail side"
          className="rail-btn rail-flip"
        >
          <ArrowLeftRight size={15} />
        </button>
      </div>
    </aside>
  );
}

function RailBtn({ active, Icon, label, accent, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rail-btn ${active ? 'active' : ''}`}
      style={{ '--rail-accent': accent }}
    >
      <Icon size={18} />
      <span className="rail-label">{label}</span>
    </button>
  );
}
