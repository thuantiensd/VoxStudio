import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, User, ChevronDown, ChevronUp, FolderUp, X, Check, Download, FileText, Cloud, Cpu, Play, Pause, Sparkles, Search } from 'lucide-react';
import { generateTTS, generateEdgeTTS, listVoices, listPremiumVoices, premiumPreviewUrl, listEdgeVoices, audioURL, confirmAudioReceived } from '../services/api';
import AudioPlayer from '../components/AudioPlayer';
import SpeedKnob from '../components/SpeedKnob';
import PageHeader, { Page, PageContent } from '../components/ui/PageHeader';
import Segmented from '../components/ui/Segmented';
import { useT } from '../i18n/I18nContext';
import { isQuotaError, showError } from '../services/errors';
import { useToast } from '../components/ui/Toast';
import { useUpgrade } from '../components/UpgradeContext';
import { userStorage } from '../services/userScope';
import { FolderOpen } from 'lucide-react';
import { SERVER_URL } from '../services/api';
import { WHISPER_LANGUAGES } from '../services/ttsSettings';
import LanguagePicker from '../components/ui/LanguagePicker';
import { useAuth } from '../auth/AuthContext';

// Edge TTS — chỉ list ngôn ngữ Microsoft cloud hỗ trợ (subset).
const LANGUAGE_VALUES_EDGE = [
  'auto', 'vietnamese', 'english', 'chinese', 'japanese', 'korean',
  'french', 'spanish', 'german', 'portuguese', 'russian', 'thai',
  'arabic', 'hindi', 'italian', 'dutch', 'turkish', 'polish',
  'indonesian', 'malay',
];

// Premium (OmniVoice) — full list 99 ngôn ngữ Whisper hỗ trợ.
// Reuse từ ttsSettings → consistent với STT/Dubbing.
const LANGUAGE_VALUES_PREMIUM = ['auto', ...WHISPER_LANGUAGES];

// Flag emoji map — value khớp locale backend.
// Ngôn ngữ không có flag mặc định → 🌐 globe.
const LANGUAGE_FLAGS = {
  auto: '🌐',
  // Châu Á
  vietnamese: '🇻🇳', chinese: '🇨🇳', cantonese: '🇭🇰', japanese: '🇯🇵',
  korean: '🇰🇷', thai: '🇹🇭', lao: '🇱🇦', khmer: '🇰🇭', burmese: '🇲🇲',
  indonesian: '🇮🇩', malay: '🇲🇾', tagalog: '🇵🇭', javanese: '🇮🇩',
  sundanese: '🇮🇩', tibetan: '🏔️', mongolian: '🇲🇳',
  // Nam Á
  hindi: '🇮🇳', bengali: '🇧🇩', tamil: '🇮🇳', telugu: '🇮🇳',
  marathi: '🇮🇳', urdu: '🇵🇰', punjabi: '🇮🇳', gujarati: '🇮🇳',
  kannada: '🇮🇳', malayalam: '🇮🇳', sinhala: '🇱🇰', nepali: '🇳🇵',
  pashto: '🇦🇫', persian: '🇮🇷', sindhi: '🇵🇰', assamese: '🇮🇳',
  sanskrit: '🇮🇳',
  // Trung Đông + Bắc Phi
  arabic: '🇸🇦', hebrew: '🇮🇱', turkish: '🇹🇷', azerbaijani: '🇦🇿',
  armenian: '🇦🇲', georgian: '🇬🇪', kazakh: '🇰🇿', uzbek: '🇺🇿',
  turkmen: '🇹🇲', tajik: '🇹🇯', kyrgyz: '🇰🇬', bashkir: '🇷🇺',
  tatar: '🇷🇺',
  // Châu Âu Tây
  english: '🇺🇸', french: '🇫🇷', spanish: '🇪🇸', german: '🇩🇪',
  italian: '🇮🇹', portuguese: '🇵🇹', dutch: '🇳🇱', greek: '🇬🇷',
  catalan: '🇪🇸', galician: '🇪🇸', basque: '🇪🇸', breton: '🇫🇷',
  occitan: '🇫🇷', welsh: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', irish: '🇮🇪', maltese: '🇲🇹',
  // Châu Âu Bắc
  swedish: '🇸🇪', norwegian: '🇳🇴', nynorsk: '🇳🇴', danish: '🇩🇰',
  finnish: '🇫🇮', icelandic: '🇮🇸', faroese: '🇫🇴', estonian: '🇪🇪',
  latvian: '🇱🇻', lithuanian: '🇱🇹',
  // Slavic
  russian: '🇷🇺', polish: '🇵🇱', czech: '🇨🇿', slovak: '🇸🇰',
  ukrainian: '🇺🇦', belarusian: '🇧🇾', bulgarian: '🇧🇬', serbian: '🇷🇸',
  croatian: '🇭🇷', slovenian: '🇸🇮', bosnian: '🇧🇦', macedonian: '🇲🇰',
  // Khác EU
  hungarian: '🇭🇺', romanian: '🇷🇴', albanian: '🇦🇱', luxembourgish: '🇱🇺',
  // Châu Phi
  swahili: '🇹🇿', amharic: '🇪🇹', somali: '🇸🇴', hausa: '🇳🇬',
  yoruba: '🇳🇬', shona: '🇿🇼', afrikaans: '🇿🇦', malagasy: '🇲🇬',
  lingala: '🇨🇩',
  // Hawaii / Oceania
  hawaiian: '🇺🇸', maori: '🇳🇿',
  // Khác
  haitian: '🇭🇹', latin: '🏛️', yiddish: '✡️',
};

function useLanguages(values = LANGUAGE_VALUES_EDGE) {
  const t = useT();
  return values.map((v) => ({
    value: v === 'auto' ? '' : v,
    label: `${LANGUAGE_FLAGS[v] || '🌐'} ${t(`langs.${v}`) === `langs.${v}` ? capitalize(v) : t(`langs.${v}`)}`.trim(),
    flag: LANGUAGE_FLAGS[v] || '🌐',
  }));
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const CHAR_LIMIT = 1000;
const CHAR_WARN = 500;
const SPEED_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5];
const TEXT_EXTS = ['.txt', '.srt', '.vtt', '.md', '.csv', '.tsv', '.json'];

const selectStyle = { background: 'var(--bg-card)', border: '1px solid #2a2a40', color: 'var(--text-primary)' };
const labelClass = "block text-sm mb-1.5";
const labelStyle = { color: 'var(--text-secondary)' };

// ── Voice picker (panel-based, ElevenLabs-style) ──────────────────────
// Trigger button hiển thị giọng đang chọn (avatar + name + meta). Click →
// expand panel có search + chips Tất cả/Nam/Nữ + list voice card có avatar
// gradient + nút ▶ play preview inline (không cần đóng panel).
//
// User clones cũng vào cùng list (group "Giọng của tôi" cuối) — avatar dùng
// initials từ name, gradient grey-tone để phân biệt với premium colorful.
//
// Audio singleton: 1 lúc chỉ 1 voice phát. Click play khác = stop cũ + play mới.

// Palette gradient cho avatar premium — 12 cặp HSL hue-shifted, đẹp + đa dạng.
// Pick deterministic theo hash(slug) → cùng giọng luôn cùng màu.
const AVATAR_PALETTES = [
  ['#8B5CF6', '#6366F1'], // violet → indigo
  ['#06B6D4', '#3B82F6'], // cyan   → blue
  ['#10B981', '#14B8A6'], // emerald → teal
  ['#F59E0B', '#EF4444'], // amber  → red
  ['#EC4899', '#F43F5E'], // pink   → rose
  ['#A855F7', '#EC4899'], // purple → pink
  ['#3B82F6', '#06B6D4'], // blue   → cyan
  ['#14B8A6', '#10B981'], // teal   → emerald
  ['#F97316', '#F59E0B'], // orange → amber
  ['#D946EF', '#A855F7'], // fuchsia → purple
  ['#0EA5E9', '#6366F1'], // sky    → indigo
  ['#EAB308', '#F97316'], // yellow → orange
];

function _hashSlug(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Lấy 2 chữ initials từ display_name (vd "Mai Anh" → "MA", "Bảo Châu" → "BC").
function _initials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function VoiceAvatar({ name, slug, isPremium, size = 40 }) {
  const colors = isPremium
    ? AVATAR_PALETTES[_hashSlug(slug) % AVATAR_PALETTES.length]
    : ['#3a3a4a', '#2a2a3a']; // user clones — neutral grey
  return (
    <div className="flex items-center justify-center font-semibold text-white flex-shrink-0"
      style={{
        width: size, height: size, borderRadius: '50%',
        background: `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)`,
        fontSize: size * 0.32,
        letterSpacing: 0.5,
      }}>
      {_initials(name)}
    </div>
  );
}

// Icon-only round play button. Reuse cho cả trigger header + voice rows.
function PlayDot({ playing, onClick, size = 36, label }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label || (playing ? 'Pause' : 'Play')}
      className="flex items-center justify-center transition-all flex-shrink-0"
      style={{
        width: size, height: size, borderRadius: '50%',
        background: playing ? 'var(--accent)' : 'var(--bg-card)',
        border: `1px solid ${playing ? 'var(--accent)' : '#2a2a40'}`,
        color: playing ? '#fff' : 'var(--text-primary)',
        boxShadow: playing ? '0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent)' : 'none',
        transform: playing ? 'scale(1.04)' : 'scale(1)',
      }}>
      {playing
        ? <Pause size={size * 0.4} fill="currentColor" />
        : <Play size={size * 0.4} fill="currentColor" style={{ marginLeft: 1 }} />}
    </button>
  );
}

// Resolve language code → human label qua i18n. Reuse `langs.*` keys
// đã có sẵn (langs.vietnamese, langs.english, ...) để khỏi maintain map riêng.
function _langLabel(code, t) {
  if (!code) return '';
  const key = `langs.${code}`;
  const translated = t(key);
  // I18nContext trả lại key gốc nếu missing → fallback capitalize code.
  if (translated === key) return code.charAt(0).toUpperCase() + code.slice(1);
  return translated;
}
function _genderLabel(g, t) {
  if (g === 'female') return t('tts.genderFemale');
  if (g === 'male') return t('tts.genderMale');
  return '';
}

function VoiceRow({ voice, isPremium, isSelected, isPlaying, onSelect, onPlay, hasPreview, t }) {
  const name = isPremium ? voice.display_name : voice.name;
  const slug = isPremium ? voice.slug : voice.id;
  const langLabel = isPremium ? _langLabel(voice.language, t) : t('tts.userVoiceMeta');
  const genderLabel = _genderLabel(voice.gender, t);
  const meta = [langLabel, genderLabel].filter(Boolean).join(' · ');
  return (
    <div onClick={onSelect}
      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
      style={{
        background: isSelected ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
        border: `1px solid ${isSelected ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'transparent'}`,
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-surface)'; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
      <VoiceAvatar name={name} slug={slug} isPremium={isPremium} size={40} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
          {name}
        </div>
        <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
          {meta}
        </div>
      </div>
      {hasPreview
        ? <PlayDot playing={isPlaying} onClick={onPlay} size={36}
            label={isPlaying ? t('tts.previewPause') : t('tts.previewPlay')} />
        : <div style={{ width: 36, height: 36 }} aria-hidden />}
    </div>
  );
}

function PremiumVoicePicker({
  voiceId, setVoiceId, premiumVoices, userVoices, language, t,
}) {
  const audioRef = useRef(null);
  const containerRef = useRef(null);
  const [playingId, setPlayingId] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState('all');

  // Stop audio khi đóng panel hoặc đổi voice ngoài picker.
  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId('');
  };

  // Click outside → close panel.
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isOpen]);

  const playPreview = (voice) => {
    const id = voice.slug || voice.id;
    if (audioRef.current && playingId === id) {
      stopAudio();
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const url = voice.preview_url ? premiumPreviewUrl(voice.slug) : null;
    if (!url) return;
    const a = new Audio(url);
    a.onended = () => { setPlayingId(''); audioRef.current = null; };
    a.onerror = () => { setPlayingId(''); audioRef.current = null; };
    a.play().then(() => {
      audioRef.current = a;
      setPlayingId(id);
    }).catch(() => {});
  };

  // Filter — language khớp picker (rỗng = show all), gender filter chip,
  // search match display_name/name (case-insensitive, normalize accent).
  const langKey = (language || '').toLowerCase();
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(search.trim());
  const matchSearch = (label) => !q || norm(label).includes(q);

  const visiblePremium = useMemo(() => premiumVoices.filter(v =>
    (!langKey || v.language === langKey) &&
    (genderFilter === 'all' || v.gender === genderFilter) &&
    matchSearch(v.display_name)
  ), [premiumVoices, langKey, genderFilter, q]);

  const visibleUser = useMemo(() => userVoices.filter(v =>
    matchSearch(v.name)
    // user clones không có gender → chỉ show khi filter='all'
    && genderFilter === 'all'
  ), [userVoices, genderFilter, q]);

  const femalePremium = visiblePremium.filter(v => v.gender === 'female');
  const malePremium = visiblePremium.filter(v => v.gender === 'male');

  const selectedPremium = premiumVoices.find(v => v.slug === voiceId);
  const selectedUser = userVoices.find(v => v.id === voiceId);
  const selected = selectedPremium || selectedUser;
  const selectedIsPremium = !!selectedPremium;
  const triggerName = selected
    ? (selectedIsPremium ? selected.display_name : selected.name)
    : t('tts.voiceDefault');
  const triggerMeta = selected
    ? (selectedIsPremium
        ? [_langLabel(selected.language, t), _genderLabel(selected.gender, t)].filter(Boolean).join(' · ')
        : t('tts.userVoiceMeta'))
    : t('tts.voiceAutoOption');
  const triggerHasPreview = !!(selectedPremium && selectedPremium.preview_url);

  const isEmpty = visiblePremium.length === 0 && visibleUser.length === 0;

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger card — luôn hiển thị giọng đang chọn */}
      <button type="button" onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
        style={{
          background: 'var(--bg-card)',
          border: `1px solid ${isOpen ? 'var(--accent)' : '#2a2a40'}`,
          textAlign: 'left',
        }}>
        {selected ? (
          <VoiceAvatar
            name={selectedIsPremium ? selected.display_name : selected.name}
            slug={selectedIsPremium ? selected.slug : selected.id}
            isPremium={selectedIsPremium} size={36} />
        ) : (
          <div className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--bg-surface)', border: '1px dashed #3a3a4a',
            }}>
            <Sparkles size={16} style={{ color: 'var(--text-secondary)' }} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
            {triggerName}
          </div>
          <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
            {triggerMeta}
          </div>
        </div>
        {triggerHasPreview && (
          <PlayDot playing={playingId === selected.slug}
            onClick={() => playPreview(selected)} size={32}
            label={playingId === selected.slug ? t('tts.previewPause') : t('tts.previewPlay')} />
        )}
        <ChevronDown size={16} style={{
          color: 'var(--text-secondary)',
          transition: 'transform 150ms',
          transform: isOpen ? 'rotate(180deg)' : 'none',
        }} />
      </button>

      {/* Panel — search + chips + list */}
      {isOpen && (
        <div className="absolute left-0 right-0 mt-2 rounded-xl overflow-hidden z-20"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid #2a2a40',
            boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
          }}>
          {/* Search */}
          <div className="p-3 pb-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: 'var(--bg-surface)', border: '1px solid #2a2a40' }}>
              <Search size={14} style={{ color: 'var(--text-secondary)' }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('tts.searchVoice')}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--text-primary)' }} />
              {search && (
                <button onClick={() => setSearch('')}
                  className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          {/* Filter chips — pill style match reference design */}
          <div className="px-3 pb-2 flex gap-2">
            {[
              { value: 'all',    label: t('tts.filterAll') },
              { value: 'female', label: t('tts.filterFemale') },
              { value: 'male',   label: t('tts.filterMale') },
            ].map(opt => {
              const active = genderFilter === opt.value;
              return (
                <button key={opt.value} type="button"
                  onClick={() => setGenderFilter(opt.value)}
                  className="px-3.5 py-1 rounded-full text-xs font-medium transition-colors"
                  style={{
                    background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
                    border: `1px solid ${active ? 'var(--accent)' : '#2a2a40'}`,
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
          {/* Divider */}
          <div style={{ height: 1, background: '#2a2a40' }} />
          {/* List */}
          <div className="px-2 py-2 max-h-80 overflow-y-auto flex flex-col gap-1">
            {/* Default option */}
            <div onClick={() => { setVoiceId(''); setIsOpen(false); }}
              className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
              style={{
                background: !voiceId ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
                border: `1px solid ${!voiceId ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'transparent'}`,
              }}
              onMouseEnter={(e) => { if (voiceId) e.currentTarget.style.background = 'var(--bg-surface)'; }}
              onMouseLeave={(e) => { if (voiceId) e.currentTarget.style.background = 'transparent'; }}>
              <div className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'var(--bg-surface)', border: '1px dashed #3a3a4a',
                }}>
                <Sparkles size={18} style={{ color: 'var(--text-secondary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                  {t('tts.voiceAutoOption')}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {t('tts.voiceAutoMeta')}
                </div>
              </div>
            </div>

            {/* Premium voices */}
            {femalePremium.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}>
                  {t('tts.premiumGroupFemale')}
                </div>
                {femalePremium.map(v => (
                  <VoiceRow key={v.slug} voice={v} isPremium t={t}
                    isSelected={voiceId === v.slug}
                    isPlaying={playingId === v.slug}
                    hasPreview={!!v.preview_url}
                    onSelect={() => { setVoiceId(v.slug); setIsOpen(false); stopAudio(); }}
                    onPlay={() => playPreview(v)} />
                ))}
              </>
            )}
            {malePremium.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}>
                  {t('tts.premiumGroupMale')}
                </div>
                {malePremium.map(v => (
                  <VoiceRow key={v.slug} voice={v} isPremium t={t}
                    isSelected={voiceId === v.slug}
                    isPlaying={playingId === v.slug}
                    hasPreview={!!v.preview_url}
                    onSelect={() => { setVoiceId(v.slug); setIsOpen(false); stopAudio(); }}
                    onPlay={() => playPreview(v)} />
                ))}
              </>
            )}

            {/* User clones */}
            {visibleUser.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}>
                  {t('tts.userVoicesGroup')}
                </div>
                {visibleUser.map(v => (
                  <VoiceRow key={v.id} voice={v} isPremium={false} t={t}
                    isSelected={voiceId === v.id}
                    isPlaying={false}
                    hasPreview={false}
                    onSelect={() => { setVoiceId(v.id); setIsOpen(false); stopAudio(); }}
                    onPlay={() => {}} />
                ))}
              </>
            )}

            {isEmpty && (
              <div className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('tts.noVoicesFound')}
                {q && <div className="text-xs mt-1">{t('tts.tryAdjustFilter')}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ── EdgeVoicePicker (VoxCloud / Standard mode) ────────────────────────
// Match visual rhythm với PremiumVoicePicker — cùng trigger card +
// dropdown panel + voice cards có avatar gradient. Edge voices dùng
// neutral grey gradient (không có gender-color như premium).
//
// Edge voices đã filter sẵn theo language ở SettingsPanel level
// (filteredEdgeVoices), picker chỉ apply gender filter + search.

// Map override để hiển thị tên giọng Edge tử tế thay vì raw "vi-VN-HoaiMyNeural".
// Ưu tiên đúng dấu tiếng Việt cho Vietnamese voices. Voice nào không có
// trong map sẽ fallback sang _humanizeEdgeName() (strip locale + split CamelCase).
const EDGE_VOICE_DISPLAY_OVERRIDES = {
  // Tiếng Việt
  'vi-VN-HoaiMyNeural': 'Hoài My',
  'vi-VN-NamMinhNeural': 'Nam Minh',
};

function _humanizeEdgeName(rawName) {
  if (!rawName) return '';
  if (EDGE_VOICE_DISPLAY_OVERRIDES[rawName]) return EDGE_VOICE_DISPLAY_OVERRIDES[rawName];
  // Bỏ suffix "Neural" + locale prefix (vd "en-US-", "fr-FR-", "zh-CN-").
  let s = rawName.replace(/Neural$/, '').trim();
  s = s.replace(/^[a-z]{2,3}-[A-Z]{2,4}-/, '');
  // Split CamelCase: "HoaiMy" → "Hoai My", "AndrewMultilingual" → "Andrew Multilingual".
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  return s;
}

// Backward-compat alias — _stripNeural() được dùng vài chỗ; giờ delegate sang
// humanize cho consistent.
const _stripNeural = _humanizeEdgeName;

function EdgeVoiceRow({ voice, isSelected, onSelect, t }) {
  const display = _stripNeural(voice.name);
  // Locale code (vd "vi-VN-HoaiMyNeural" → "vi-VN") + gender
  const locale = voice.locale || (voice.name?.split("-").slice(0, 2).join("-")) || "";
  const genderKey = (voice.gender || '').toLowerCase();
  const gender = genderKey === 'female' ? t('tts.genderFemale')
    : genderKey === 'male' ? t('tts.genderMale') : '';
  const meta = [locale, gender].filter(Boolean).join(" · ");
  return (
    <div onClick={onSelect}
      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
      style={{
        background: isSelected ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
        border: `1px solid ${isSelected ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "transparent"}`,
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-surface)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
      <VoiceAvatar name={display} slug={voice.name} isPremium={false} size={40} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate" style={{ color: "var(--text-primary)" }}>
          {display}
        </div>
        <div className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
          {meta}
        </div>
      </div>
    </div>
  );
}

function EdgeVoicePicker({ voiceName, setVoiceName, edgeVoices, t }) {
  const containerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState('all');

  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isOpen]);

  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(search.trim());

  const visible = useMemo(() => edgeVoices.filter(v => {
    if (genderFilter !== 'all' && (v.gender || '').toLowerCase() !== genderFilter) return false;
    if (!q) return true;
    return norm(v.name).includes(q) || norm(v.locale || '').includes(q);
  }), [edgeVoices, genderFilter, q]);

  const female = visible.filter(v => (v.gender || '').toLowerCase() === 'female');
  const male = visible.filter(v => (v.gender || '').toLowerCase() === 'male');

  const selected = edgeVoices.find(v => v.name === voiceName);
  const triggerName = selected ? _stripNeural(selected.name) : t('tts.autoVoice');
  const selGenderKey = (selected?.gender || '').toLowerCase();
  const selGenderLabel = selGenderKey === 'female' ? t('tts.genderFemale')
    : selGenderKey === 'male' ? t('tts.genderMale') : '';
  const triggerMeta = selected
    ? [(selected.locale || ''), selGenderLabel].filter(Boolean).join(' · ')
    : t('tts.edgeAutoMeta');

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
        style={{
          background: 'var(--bg-card)',
          border: `1px solid ${isOpen ? 'var(--accent)' : '#2a2a40'}`,
          textAlign: 'left',
        }}>
        {selected ? (
          <VoiceAvatar name={_stripNeural(selected.name)} slug={selected.name} isPremium={false} size={36} />
        ) : (
          <div className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--bg-surface)', border: '1px dashed #3a3a4a',
            }}>
            <Cloud size={16} style={{ color: 'var(--text-secondary)' }} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
            {triggerName}
          </div>
          <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
            {triggerMeta}
          </div>
        </div>
        <ChevronDown size={16} style={{
          color: 'var(--text-secondary)',
          transition: 'transform 150ms',
          transform: isOpen ? 'rotate(180deg)' : 'none',
        }} />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-2 rounded-xl overflow-hidden z-20"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid #2a2a40',
            boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
          }}>
          {/* Search */}
          <div className="p-3 pb-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: 'var(--bg-surface)', border: '1px solid #2a2a40' }}>
              <Search size={14} style={{ color: 'var(--text-secondary)' }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('tts.searchVoice')}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--text-primary)' }} />
              {search && (
                <button onClick={() => setSearch('')}
                  className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          {/* Filter chips */}
          <div className="px-3 pb-2 flex gap-2">
            {[
              { value: 'all',    label: t('tts.filterAll') },
              { value: 'female', label: t('tts.filterFemale') },
              { value: 'male',   label: t('tts.filterMale') },
            ].map(opt => {
              const active = genderFilter === opt.value;
              return (
                <button key={opt.value} type="button"
                  onClick={() => setGenderFilter(opt.value)}
                  className="px-3.5 py-1 rounded-full text-xs font-medium transition-colors"
                  style={{
                    background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
                    border: `1px solid ${active ? 'var(--accent)' : '#2a2a40'}`,
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div style={{ height: 1, background: '#2a2a40' }} />
          {/* List */}
          <div className="px-2 py-2 max-h-80 overflow-y-auto flex flex-col gap-1">
            {/* Auto option */}
            <div onClick={() => { setVoiceName(''); setIsOpen(false); }}
              className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
              style={{
                background: !voiceName ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
                border: `1px solid ${!voiceName ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'transparent'}`,
              }}
              onMouseEnter={(e) => { if (voiceName) e.currentTarget.style.background = 'var(--bg-surface)'; }}
              onMouseLeave={(e) => { if (voiceName) e.currentTarget.style.background = 'transparent'; }}>
              <div className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'var(--bg-surface)', border: '1px dashed #3a3a4a',
                }}>
                <Cloud size={18} style={{ color: 'var(--text-secondary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                  {t('tts.autoVoice')}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {t('tts.edgeAutoMeta')}
                </div>
              </div>
            </div>

            {female.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}>
                  {t('tts.standardGroupFemale')}
                </div>
                {female.map(v => (
                  <EdgeVoiceRow key={v.name} voice={v} t={t}
                    isSelected={voiceName === v.name}
                    onSelect={() => { setVoiceName(v.name); setIsOpen(false); }} />
                ))}
              </>
            )}
            {male.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}>
                  {t('tts.standardGroupMale')}
                </div>
                {male.map(v => (
                  <EdgeVoiceRow key={v.name} voice={v} t={t}
                    isSelected={voiceName === v.name}
                    onSelect={() => { setVoiceName(v.name); setIsOpen(false); }} />
                ))}
              </>
            )}

            {visible.length === 0 && (
              <div className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('tts.noVoicesFound')}
                {q && <div className="text-xs mt-1">{t('tts.tryAdjustFilter')}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function SliderControl({ label, value, onChange, min, max, step, description }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs" style={labelStyle}>{label}</span>
        <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full" />
      {description && (
        <p className="text-xs mt-0.5" style={{ color: '#555' }}>{description}</p>
      )}
    </div>
  );
}

// Map language value → Edge TTS locale prefix
const LOCALE_MAP = {
  vietnamese: 'vi', english: 'en', chinese: 'zh', japanese: 'ja', korean: 'ko',
  french: 'fr', spanish: 'es', german: 'de', portuguese: 'pt', russian: 'ru',
  thai: 'th', hindi: 'hi', arabic: 'ar', italian: 'it', dutch: 'nl',
  turkish: 'tr', polish: 'pl', indonesian: 'id', malay: 'ms',
};

// ── Shared settings hook ──
function useSharedSettings() {
  const [engine, setEngine] = useState('edge'); // 'edge' (VoxCloud) | 'omnivoice' (VoxLocal)
  const [voices, setVoices] = useState([]);          // user clones
  const [premiumVoices, setPremiumVoices] = useState([]);  // built-in presets
  const [edgeVoices, setEdgeVoices] = useState([]);
  const [voiceId, setVoiceId] = useState('');
  const [edgeVoice, setEdgeVoice] = useState('');
  const [language, setLanguage] = useState('');
  const [speed, setSpeed] = useState(1.0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [numStep, setNumStep] = useState(32);
  const [guidanceScale, setGuidanceScale] = useState(2.0);
  const [tShift, setTShift] = useState(0.1);
  const [layerPenaltyFactor, setLayerPenaltyFactor] = useState(5.0);
  const [positionTemperature, setPositionTemperature] = useState(5.0);
  const [classTemperature, setClassTemperature] = useState(0.0);
  const [denoise, setDenoise] = useState(true);
  const [preprocessPrompt, setPreprocessPrompt] = useState(true);
  const [postprocessOutput, setPostprocessOutput] = useState(true);
  const [audioChunkDuration, setAudioChunkDuration] = useState(15.0);
  const [outputFolder, setOutputFolder] = useState(() => {
    try { return userStorage.getItem('voxstudio:tts:outputFolder') || ''; }
    catch { return ''; }
  });
  const setOutputFolderPersist = useCallback((path) => {
    setOutputFolder(path || '');
    try { userStorage.setItem('voxstudio:tts:outputFolder', path || ''); } catch {}
  }, []);

  useEffect(() => {
    listVoices().then(r => setVoices(r.voices || [])).catch(() => {});
    listPremiumVoices().then(r => setPremiumVoices(r.voices || [])).catch(() => {});
    listEdgeVoices().then(r => setEdgeVoices(r.voices || [])).catch(() => {});
  }, []);

  // selectedVoice: tìm trong premium pool trước (slug-based), fallback user clones
  const selectedVoice =
    premiumVoices.find(v => v.slug === voiceId) ||
    voices.find(v => v.id === voiceId);
  const isSelectedPremium = !!premiumVoices.find(v => v.slug === voiceId);

  // Filter edge voices by selected language
  const langPrefix = LOCALE_MAP[language] || '';
  const filteredEdgeVoices = langPrefix
    ? edgeVoices.filter(v => v.locale.startsWith(langPrefix))
    : edgeVoices;

  const ttsParams = () => ({
    voiceId, language: language || undefined, speed, numStep,
    guidanceScale, tShift, layerPenaltyFactor,
    positionTemperature, classTemperature,
    denoise, preprocessPrompt, postprocessOutput, audioChunkDuration,
  });

  return {
    engine, setEngine,
    voices, premiumVoices, voiceId, setVoiceId,
    edgeVoices: filteredEdgeVoices, edgeVoice, setEdgeVoice,
    language, setLanguage,
    speed, setSpeed, selectedVoice, isSelectedPremium, ttsParams,
    showAdvanced, setShowAdvanced,
    numStep, setNumStep, guidanceScale, setGuidanceScale,
    tShift, setTShift, layerPenaltyFactor, setLayerPenaltyFactor,
    positionTemperature, setPositionTemperature,
    classTemperature, setClassTemperature,
    denoise, setDenoise, preprocessPrompt, setPreprocessPrompt,
    postprocessOutput, setPostprocessOutput,
    audioChunkDuration, setAudioChunkDuration,
    outputFolder, setOutputFolder: setOutputFolderPersist,
  };
}

/**
 * Auto-save audio file đã generate về folder user chọn (Electron only).
 * Dùng IPC saveRemoteFileToFolder — backend yêu cầu Authorization Bearer
 * cho /tts/audio/<id>, nên phải truyền header.
 */
async function autoSaveAudio({ audioUrl, folder, baseName, toast, t }) {
  if (!folder) return null;
  if (!window.voxstudio?.saveRemoteFileToFolder) {
    toast.warn(t('tts.desktopOnly'));
    return null;
  }
  try {
    let authHeaders = { 'ngrok-skip-browser-warning': 'true' };
    try {
      const raw = localStorage.getItem('voxstudio:auth');
      if (raw) {
        const { token } = JSON.parse(raw);
        if (token) authHeaders['Authorization'] = `Bearer ${token}`;
      }
    } catch { /* ignore */ }
    const url = audioUrl.startsWith('http') ? audioUrl : `${SERVER_URL}${audioUrl}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safe = (baseName || 'tts').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 60) || 'tts';
    const filename = `${safe}_${stamp}.wav`;
    const savedPath = await window.voxstudio.saveRemoteFileToFolder({
      url, folder, filename, headers: authHeaders,
    });
    if (savedPath) {
      toast.success(t('tts.autoSavedAt', { path: savedPath }), { duration: 6000 });
      // Báo server đã tải xong → server xoá file ngay (privacy + storage).
      // Đã có file local nên user vẫn play preview được qua file:// URL
      // (xem AudioPlayer: result.local_path được ưu tiên hơn audio_url).
      // Best-effort: lỗi confirm không ảnh hưởng user vì server có TTL cleanup.
      confirmAudioReceived(audioUrl).catch(() => {});
    }
    return savedPath;
  } catch (e) {
    console.warn('autoSaveAudio failed:', e);
    toast.error(t('tts.autoSaveFailed'));
    return null;
  }
}

// ── Folder picker for auto-save (Electron only) ──
function FolderPickerSection({ s }) {
  const t = useT();
  const toast = useToast();
  const isElectron = !!window.voxstudio?.pickFolder;

  const pick = async () => {
    if (!isElectron) {
      toast.warn(t('tts.desktopOnly'));
      return;
    }
    try {
      const f = await window.voxstudio.pickFolder();
      if (f) s.setOutputFolder(f);
    } catch { /* user canceled */ }
  };

  return (
    <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
      <div className="flex items-center gap-2 mb-2">
        <FolderOpen size={14} style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('tts.saveFolder')}</span>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>{t('tts.saveFolderHint')}</p>
      <div className="flex items-center gap-2">
        <div
          title={s.outputFolder || t('tts.folderNone')}
          className="flex-1 px-3 py-2 rounded-md text-xs font-mono"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid #2a2a40',
            color: s.outputFolder ? 'var(--text-primary)' : 'var(--text-secondary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {s.outputFolder || t('tts.folderNone')}
        </div>
        <button onClick={pick}
          className="px-3 py-2 rounded-md text-xs font-medium"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          {s.outputFolder ? t('tts.changeFolder') : t('tts.chooseFolder')}
        </button>
        {s.outputFolder && (
          <button onClick={() => s.setOutputFolder('')}
            className="px-3 py-2 rounded-md text-xs"
            style={{ background: 'var(--bg-surface)', border: '1px solid #2a2a40', color: 'var(--text-secondary)' }}>
            {t('tts.clearFolder')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Shared settings UI ──
function SettingsPanel({ s }) {
  const t = useT();
  const isCloud = s.engine === 'edge';
  // Premium = full 99 ngôn ngữ Whisper. Standard = subset Edge cloud.
  const languages = useLanguages(
    isCloud ? LANGUAGE_VALUES_EDGE : LANGUAGE_VALUES_PREMIUM,
  );


  return (
    <>
      {/* Engine toggle: VoxCloud / VoxLocal */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ background: 'var(--bg-card)' }}>
        <button onClick={() => s.setEngine('edge')}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors"
          style={{
            background: isCloud ? 'var(--accent)' : 'transparent',
            color: isCloud ? '#fff' : 'var(--text-secondary)',
          }}>
          <Cloud size={14} /> {t('tts.cloudName')}
        </button>
        <button onClick={() => s.setEngine('omnivoice')}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors"
          style={{
            background: !isCloud ? 'var(--accent)' : 'transparent',
            color: !isCloud ? '#fff' : 'var(--text-secondary)',
          }}>
          <Cpu size={14} /> {t('tts.localName')}
        </button>
      </div>

      {/* Engine description */}
      <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
        {isCloud ? t('tts.cloudDesc') : t('tts.localDesc')}
      </p>

      {/* Voice + Language */}
      <div className="flex gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <label className={labelClass} style={labelStyle}>{t('tts.voice')}</label>
          {isCloud ? (
            <EdgeVoicePicker
              voiceName={s.edgeVoice}
              setVoiceName={s.setEdgeVoice}
              edgeVoices={s.edgeVoices}
              t={t}
            />
          ) : (
            <PremiumVoicePicker
              voiceId={s.voiceId}
              setVoiceId={s.setVoiceId}
              premiumVoices={s.premiumVoices}
              userVoices={s.voices}
              language={s.language}
              t={t}
            />
          )}
        </div>
        <div className="flex-1">
          <label className={labelClass} style={labelStyle}>{t('tts.language')}</label>
          <LanguagePicker
            options={languages}
            value={s.language}
            onChange={(v) => s.setLanguage(v)}
          />
        </div>
      </div>

      {/* Voice info card (chỉ VoxLocal + clone — premium đã có meta trong picker trigger) */}
      {!isCloud && s.voiceId && s.selectedVoice && !s.isSelectedPremium && s.selectedVoice.ref_text && (
        <div className="mb-4 p-3 rounded-lg flex items-start gap-3"
          style={{ background: 'var(--bg-surface)', border: '1px solid #2a2a40' }}>
          <User size={16} style={{ color: 'var(--accent)', marginTop: 2 }} />
          <p className="text-xs flex-1" style={labelStyle}>
            Ref: &ldquo;{s.selectedVoice.ref_text.length > 80 ? s.selectedVoice.ref_text.slice(0, 80) + '...' : s.selectedVoice.ref_text}&rdquo;
          </p>
        </div>
      )}

      {/* Speed knob */}
      <div className="flex flex-col items-center gap-3 mb-5 p-4 rounded-lg"
        style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
        <SpeedKnob value={s.speed} onChange={s.setSpeed} min={0.5} max={1.5} step={0.05} />
        <div className="flex gap-2 flex-wrap justify-center">
          {SPEED_PRESETS.map(sp => (
            <button key={sp} onClick={() => s.setSpeed(sp)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                background: s.speed === sp ? 'var(--accent)' : 'var(--bg-surface)',
                color: s.speed === sp ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${s.speed === sp ? 'var(--accent)' : '#2a2a40'}`,
              }}>
              {sp}x
            </button>
          ))}
        </div>
      </div>

      {/* Advanced toggle (VoxLocal only) */}
      {!isCloud && (
        <>
          <button onClick={() => s.setShowAdvanced(!s.showAdvanced)}
            className="flex items-center gap-2 mb-4 text-sm transition-colors"
            style={{ color: 'var(--text-secondary)' }}>
            {s.showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {t('tts.advanced')}
          </button>

          {s.showAdvanced && (
            <div className="mb-5 p-4 rounded-lg space-y-4"
              style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
              <div className="grid grid-cols-2 gap-4">
                <SliderControl label={t('tts.steps')} value={s.numStep}
                  onChange={v => s.setNumStep(Math.round(v))} min={4} max={64} step={1} />
                <SliderControl label={t('tts.guidance')} value={s.guidanceScale.toFixed(1)}
                  onChange={s.setGuidanceScale} min={0} max={4} step={0.1} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <SliderControl label={t('tts.tShift')} value={s.tShift.toFixed(2)}
                  onChange={s.setTShift} min={0} max={1} step={0.01} />
                <SliderControl label={t('tts.layerPenalty')} value={s.layerPenaltyFactor.toFixed(1)}
                  onChange={s.setLayerPenaltyFactor} min={0} max={20} step={0.5} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <SliderControl label={t('tts.posTemp')} value={s.positionTemperature.toFixed(1)}
                  onChange={s.setPositionTemperature} min={0} max={20} step={0.5} />
                <SliderControl label={t('tts.classTemp')} value={s.classTemperature.toFixed(2)}
                  onChange={s.setClassTemperature} min={0} max={2} step={0.05} />
              </div>
              <SliderControl label={t('tts.chunkDur')} value={s.audioChunkDuration.toFixed(1)}
                onChange={s.setAudioChunkDuration} min={5} max={30} step={0.5} />
              <div className="flex gap-6 pt-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={labelStyle}>
                  <input type="checkbox" checked={s.denoise} onChange={e => s.setDenoise(e.target.checked)} /> {t('tts.denoise')}
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={labelStyle}>
                  <input type="checkbox" checked={s.preprocessPrompt} onChange={e => s.setPreprocessPrompt(e.target.checked)} /> {t('tts.preprocess')}
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={labelStyle}>
                  <input type="checkbox" checked={s.postprocessOutput} onChange={e => s.setPostprocessOutput(e.target.checked)} /> {t('tts.postprocess')}
                </label>
              </div>
            </div>
          )}
        </>
      )}

      {/* Auto-save folder (Electron only) — đặt cuối cùng vì là tuỳ chọn output */}
      <FolderPickerSection s={s} />
    </>
  );
}

// ══════════════════════════════════════════════════════
// Main page
// ══════════════════════════════════════════════════════
export default function TTSPage() {
  const t = useT();
  const [mode, setMode] = useState('single'); // 'single' | 'batch'
  const s = useSharedSettings();

  return (
    <Page>
      <PageHeader
        title="Text to Speech"
        subtitle={t('tts.subtitle')}
      >
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'single', label: t('tts.singleTab') },
            { value: 'batch',  label: t('tts.batchTab') },
          ]}
        />
      </PageHeader>
      <PageContent maxWidth={760}>
        {mode === 'single' ? <SingleMode s={s} /> : <BatchMode s={s} />}
      </PageContent>
    </Page>
  );
}

// ══════════════════════════════════════════════════════
// Single mode (original)
// ══════════════════════════════════════════════════════
function SingleMode({ s }) {
  const t = useT();
  const toast = useToast();
  const upgrade = useUpgrade();
  const { auth } = useAuth();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Per-request char limit theo plan từ /auth/me. -1 = unlimited (Studio).
  // Free fallback CHAR_LIMIT (1000) nếu plan chưa load (vd lúc khởi động).
  const planLimit = auth?.plan?.limits?.tts_max_chars_request;
  const isUnlimited = planLimit === -1;
  const effectiveLimit = isUnlimited ? Infinity : (planLimit ?? CHAR_LIMIT);
  const overLimit = text.length > effectiveLimit;
  const charColor = overLimit
    ? 'var(--danger)'
    : (!isUnlimited && text.length >= effectiveLimit * 0.5)
        ? '#f0a030'
        : 'var(--text-secondary)';

  const generate = async () => {
    if (!text.trim() || overLimit) return;
    // BẮT BUỘC chọn folder lưu trước khi generate (Electron only).
    // Server sẽ xoá file ngay sau khi client tải về → cần folder hợp lệ.
    const isElectron = !!window.voxstudio?.pickFolder;
    if (isElectron && !s.outputFolder) {
      const picked = await window.voxstudio.pickFolder();
      if (!picked) {
        toast.warn(t('tts.folderRequired'));
        return;
      }
      s.setOutputFolder(picked);
    }
    setLoading(true); setError(''); setResult(null);
    try {
      let r;
      if (s.engine === 'edge') {
        r = await generateEdgeTTS({ text, voice: s.edgeVoice || undefined, language: s.language || undefined, speed: s.speed });
      } else {
        r = await generateTTS({ text, ...s.ttsParams() });
      }
      // Set kết quả ngay (audio_url server) để player render — preview qua server
      // trong khi đợi auto-save xong.
      setResult(r);
      // Auto-save về máy nếu user đã đặt outputFolder (Electron only).
      // AWAIT để có local_path → update result → AudioPlayer play từ file local.
      // Sau khi local có file → confirmAudioReceived xoá server (xảy ra trong autoSaveAudio).
      if (s.outputFolder && r?.audio_url) {
        const savedPath = await autoSaveAudio({
          audioUrl: r.audio_url, folder: s.outputFolder,
          baseName: text.trim().slice(0, 40), toast, t,
        });
        if (savedPath) {
          // Update result với local_path → AudioPlayer auto-switch sang file://
          setResult((prev) => prev ? { ...prev, local_path: savedPath } : prev);
        }
      }
    } catch (e) {
      if (isQuotaError(e)) upgrade.open(e.message);
      else setError(e.message);
    }
    setLoading(false);
  };

  return (
    <>
      {/* Text input */}
      <label className={labelClass} style={labelStyle}>{t('tts.text')}</label>
      <textarea value={text} onChange={e => setText(e.target.value)}
        placeholder={t('tts.textPlaceholder')}
        rows={8} className="w-full p-3 rounded-lg mb-1 text-sm resize-none"
        style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40', color: 'var(--text-primary)' }} />
      <div className="flex justify-between text-xs mb-5">
        <span style={{ color: charColor }}>
          {/* Studio (unlimited): chỉ show count, không có / max. Free/Pro: show n / max */}
          {isUnlimited
            ? `${text.length.toLocaleString()} ${t('tts.chars')}`
            : t('tts.charCount', { n: text.length, max: effectiveLimit })}
          {overLimit && ' — ' + t('tts.charOver')}
        </span>
      </div>

      <SettingsPanel s={s} />

      <button onClick={generate} disabled={loading || !text.trim() || overLimit}
        className="w-full py-3 rounded-lg font-medium text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
        style={{ background: 'var(--accent)' }}>
        {loading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            <span>{t('tts.generating')}</span>
            <span className="flex gap-1 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          </>
        ) : t('tts.generate')}
      </button>

      {error && (
        <div className="mt-4 p-3 rounded-lg text-sm" style={{ background: '#2a1a1a', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="mt-5">
          <p className="text-sm mb-2" style={labelStyle}>{t('tts.duration')} {result.duration}s</p>
          <AudioPlayer src={result.local_path
            ? `file://${result.local_path}`
            : audioURL(result.audio_url)} />
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════
// Batch mode
// ══════════════════════════════════════════════════════
function BatchMode({ s }) {
  const t = useT();
  const toast = useToast();
  const upgrade = useUpgrade();
  const fileRef = useRef(null);
  const [files, setFiles] = useState([]); // { id, name, text, status, result, error }
  const [processing, setProcessing] = useState(false);
  const cancelRef = useRef(false);

  const readTextFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const parseSRT = (raw) => {
    // SRT format: index\ntimecode\ntext\n\n
    return raw.split(/\n\s*\n/).map(block => {
      const lines = block.trim().split('\n');
      // Skip index line (number) and timecode line (contains -->)
      const textLines = lines.filter(l =>
        !/^\d+\s*$/.test(l.trim()) && !l.includes('-->')
      );
      return textLines.join(' ').trim();
    }).filter(Boolean).join('\n');
  };

  const parseVTT = (raw) => {
    // VTT format: WEBVTT header, then same as SRT but may have styles
    const blocks = raw.split(/\n\s*\n/);
    return blocks.map(block => {
      const lines = block.trim().split('\n');
      const textLines = lines.filter(l =>
        !/^WEBVTT/.test(l) &&
        !/^NOTE/.test(l) &&
        !/^STYLE/.test(l) &&
        !/^\d+\s*$/.test(l.trim()) &&
        !l.includes('-->') &&
        !/^Kind:|^Language:/.test(l)
      );
      // Strip VTT tags like <b>, <i>, <c.classname>
      return textLines.join(' ').replace(/<[^>]+>/g, '').trim();
    }).filter(Boolean).join('\n');
  };

  const extractText = (raw, ext) => {
    if (ext === '.srt') return parseSRT(raw);
    if (ext === '.vtt') return parseVTT(raw);
    return raw.trim();
  };

  const handleFiles = async (fileList) => {
    const newFiles = [];
    for (const file of fileList) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!TEXT_EXTS.includes(ext)) continue;
      try {
        const raw = await readTextFile(file);
        const text = extractText(raw, ext);
        if (!text.trim()) continue;
        newFiles.push({
          id: crypto.randomUUID(),
          name: file.name,
          text: text.trim(),
          status: 'pending',
          result: null,
          error: null,
        });
      } catch {}
    }
    setFiles(prev => [...prev, ...newFiles]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const items = e.dataTransfer.items;
    if (items) {
      const allFiles = [];
      const promises = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          promises.push(collectFiles(entry, allFiles));
        }
      }
      Promise.all(promises).then(() => handleFiles(allFiles));
    } else {
      handleFiles(e.dataTransfer.files);
    }
  };

  const collectFiles = (entry, result) => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(f => { result.push(f); resolve(); });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        reader.readEntries(async (entries) => {
          for (const e of entries) {
            await collectFiles(e, result);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearAll = () => {
    setFiles([]);
  };

  const startBatch = async () => {
    setProcessing(true);
    cancelRef.current = false;

    const params = s.ttsParams();
    const isCloud = s.engine === 'edge';

    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) break;
      const f = files[i];
      if (f.status === 'done') continue;

      setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: 'processing' } : x));

      try {
        let r;
        if (isCloud) {
          r = await generateEdgeTTS({ text: f.text, voice: s.edgeVoice || undefined, language: s.language || undefined, speed: s.speed });
        } else {
          r = await generateTTS({ text: f.text, ...params });
        }
        setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: 'done', result: r } : x));
        // Auto-save từng file batch nếu có outputFolder. AWAIT để có local_path
        // → AudioPlayer batch dùng file:// (server đã xoá sau confirm).
        if (s.outputFolder && r?.audio_url) {
          const savedPath = await autoSaveAudio({
            audioUrl: r.audio_url, folder: s.outputFolder,
            baseName: f.name?.replace(/\.[^.]+$/, '') || `tts_${i + 1}`,
            toast, t,
          });
          if (savedPath) {
            setFiles(prev => prev.map(x => x.id === f.id
              ? { ...x, result: { ...x.result, local_path: savedPath } }
              : x));
          }
        }
      } catch (e) {
        if (isQuotaError(e)) {
          upgrade.open(e.message);
          setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: 'pending', error: null } : x));
          cancelRef.current = true;
          break;
        }
        setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: 'error', error: e.message } : x));
      }
    }

    setProcessing(false);
  };

  const stopBatch = () => {
    cancelRef.current = true;
  };

  const doneCount = files.filter(f => f.status === 'done').length;
  const errorCount = files.filter(f => f.status === 'error').length;
  const totalCount = files.length;

  return (
    <>
      {/* Drop zone */}
      <div
        className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer mb-5 transition-colors"
        style={{ borderColor: '#2a2a40', background: 'var(--bg-card)' }}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        <input ref={fileRef} type="file" accept=".txt,.srt,.vtt,.md,.csv,.tsv,.json" multiple
          className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
        />
        <FolderUp size={32} className="mx-auto mb-3" style={{ color: 'var(--text-secondary)' }} />
        <p className="text-sm mb-1">Drop files or folder here, or click to browse</p>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Supports: {TEXT_EXTS.join(', ')} — Each file generates one audio
        </p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <>
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm" style={labelStyle}>
              {totalCount} file{totalCount > 1 ? 's' : ''}
              {doneCount > 0 && <span style={{ color: 'var(--success)' }}> — {doneCount} done</span>}
              {errorCount > 0 && <span style={{ color: 'var(--danger)' }}> — {errorCount} failed</span>}
            </p>
            {!processing && (
              <button onClick={clearAll} className="text-xs px-3 py-1 rounded-lg"
                style={{ color: 'var(--danger)', background: 'var(--bg-surface)' }}>
                Clear All
              </button>
            )}
          </div>

          <div className="space-y-2 mb-5" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg"
                style={{ background: 'var(--bg-surface)', border: '1px solid #2a2a40' }}>
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {f.status === 'pending' && <FileText size={16} style={{ color: 'var(--text-secondary)' }} />}
                  {f.status === 'processing' && <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />}
                  {f.status === 'done' && <Check size={16} style={{ color: 'var(--success)' }} />}
                  {f.status === 'error' && <X size={16} style={{ color: 'var(--danger)' }} />}
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm truncate">{f.name}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      {f.status === 'done' && f.result && (
                        <a href={f.result.local_path
                            ? `file://${f.result.local_path}`
                            : audioURL(f.result.audio_url)}
                          download={f.name.replace(/\.[^.]+$/, '.wav')}
                          className="p-1.5 rounded-lg hover:opacity-80" style={{ color: 'var(--accent)' }}>
                          <Download size={14} />
                        </a>
                      )}
                      {!processing && (
                        <button onClick={() => removeFile(f.id)} className="p-1.5 rounded-lg hover:opacity-80"
                          style={{ color: 'var(--text-secondary)' }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {f.text.length} chars{f.result && ` · ${f.result.duration}s`}
                    {f.error && <span style={{ color: 'var(--danger)' }}> — {f.error}</span>}
                  </p>
                  {f.status === 'done' && f.result && (
                    <div className="mt-2">
                      <AudioPlayer src={f.result.local_path
                          ? `file://${f.result.local_path}`
                          : audioURL(f.result.audio_url)}
                        filename={f.name.replace(/\.[^.]+$/, '.wav')} compact />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <SettingsPanel s={s} />

      {/* Batch action buttons */}
      {files.length > 0 && (
        <div className="flex gap-3">
          {processing ? (
            <button onClick={stopBatch}
              className="w-full py-3 rounded-lg font-medium text-white flex items-center justify-center gap-2"
              style={{ background: 'var(--danger)' }}>
              <X size={18} /> Stop
            </button>
          ) : (
            <>
              <button onClick={startBatch} disabled={files.every(f => f.status === 'done')}
                className="flex-1 py-3 rounded-lg font-medium text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
                style={{ background: 'var(--accent)' }}>
                <FolderUp size={18} />
                {doneCount > 0 && doneCount < totalCount ? 'Resume' : 'Generate All'} ({totalCount - doneCount} files)
              </button>
              {doneCount > 0 && (
                <a href="#" onClick={(e) => {
                    e.preventDefault();
                    files.filter(f => f.status === 'done' && f.result).forEach(f => {
                      const a = document.createElement('a');
                      a.href = f.result.local_path
                        ? `file://${f.result.local_path}`
                        : audioURL(f.result.audio_url);
                      a.download = f.name.replace(/\.[^.]+$/, '.wav');
                      a.click();
                    });
                  }}
                  className="py-3 px-5 rounded-lg font-medium flex items-center gap-2"
                  style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40', color: 'var(--text-primary)' }}>
                  <Download size={18} /> Download All
                </a>
              )}
            </>
          )}
        </div>
      )}

      {/* Progress bar */}
      {processing && totalCount > 0 && (
        <div className="mt-4">
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
            <div className="h-full rounded-full transition-all" style={{
              background: 'var(--accent)',
              width: `${((doneCount + errorCount) / totalCount) * 100}%`,
            }} />
          </div>
          <p className="text-xs mt-2 text-center" style={labelStyle}>
            Processing {doneCount + errorCount + 1} / {totalCount}...
          </p>
        </div>
      )}
    </>
  );
}
