import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import Sortable from 'sortablejs';
import './index.css';
import {
  supabase,
  uploadClipToSupabase,
  deleteClipFromSupabase,
  fetchApprovedBeats,
  fetchAllBeats,
  toggleBeatApproval,
  uploadBeatToLibrary,
  fetchMasterAnalytics,
  recordProjectExport,
  uploadExportToSupabase,
  cleanupOldStaffExports,
  cleanupOldStaffClips,
  fetchRecentExports,
  fetchExportStorageStats,
  clearAllOldExports,
  VidhubBeatRow
} from './supabase';
import { getBuiltinTracks, BuiltinTrack } from './audio_synthesizer';
import {
  ImageShape,
  getNextShape,
  getShapeIcon,
  renderMaskedImageBlob,
  getShapeCssClipPath,
  renderTextOverlayBlob
} from './shape_masks';

// --- CONFIG & CONSTANTS ---
export const MASTER_PIN = '2026';
const CONFIG = (window as any).HUBLET_CONFIG || { maxClips: 5, targetResolution: { w: 720, h: 1280 }, fps: 30 };
const PX_PER_SEC = 20; // Scale of timeline (pixels per second)

export type TransitionType = 'fade' | 'crossfade' | 'white' | 'slide' | 'zoom' | 'none';

export interface TransitionConfig {
  type: TransitionType;
  duration: number; // in seconds
}

let globalTransition: TransitionConfig = {
  type: 'fade',
  duration: 0.6
};

function getTransitionDisplayName(type: TransitionType): string {
  switch (type) {
    case 'fade': return 'Fade (Black)';
    case 'crossfade': return 'Crossfade';
    case 'white': return 'White Flash';
    case 'slide': return 'Slide Left';
    case 'zoom': return 'Zoom Fade';
    case 'none': return 'Hard Cut';
    default: return 'Fade';
  }
}

export interface VideoClip {
  id: string;
  file: File | Blob;
  url: string;
  duration: number; // raw duration
  trimStart: number; // local trim in point (seconds)
  trimEnd: number; // local trim out point (seconds)
  name: string;
  fileUrl?: string; // remote Supabase storage URL if uploaded
  isPip?: boolean;
}

export interface OverlayClip {
  id: string;
  type: 'text' | 'image' | 'audio' | 'voiceover' | 'overlay_clip';
  content?: string; // Text content or image/video file url
  file?: Blob;
  style?: string; // e.g. "Fade In", "Slide", "pip", "overlay_clip"
  startTime: number; // global start time on timeline
  duration: number;
  shape?: ImageShape; // for image overlays
  x?: number; // percentage (0 - 100) on preview stage
  y?: number; // percentage (0 - 100) on preview stage
  width?: number; // percentage on preview stage
  height?: number; // percentage on preview stage
  isVideo?: boolean; // true if video overlay, false if picture
  isMuted?: boolean; // mute toggle for video overlays
}

export interface MusicTrackSelection {
  id: string;
  title: string;
  url: string;
  duration: number;
  blob?: Blob;
}

let videoSequence: VideoClip[] = [];
let overlays: OverlayClip[] = [];
let selectedMusic: MusicTrackSelection | null = null;

let currentGlobalTime = 0; // Playhead position in seconds
let isPlaying = false;
let animationFrameId = 0;

let selectedItemId: string | null = null;
let selectedItemType: 'video' | 'overlay' | null = null;

let currentClientId = sessionStorage.getItem('vidhub_client_id') || 'demo_client';
let currentStaffId = sessionStorage.getItem('vidhub_staff_id') || 'demo_staff';

// Teleprompter state
let prompterStream: MediaStream | null = null;
let prompterRecorder: MediaRecorder | null = null;
let prompterChunks: Blob[] = [];
let prompterIsRecording = false;
let prompterRecordTimerInterval = 0;
let prompterRecordSeconds = 0;
let prompterScrollSpeed: 'slow' | 'normal' | 'fast' = 'normal';
let prompterFontSize = 24;
let prompterScrollAnimId = 0;
let prompterScrollPos = 0;
let prompterTakesCount = 1;

// Background music audio playback node
const bgMusicAudio = new Audio();
bgMusicAudio.loop = true;

// Active audio nodes map for voiceovers
const activeAudioNodes = new Map<string, HTMLAudioElement>();

// --- DOM ELEMENTS ---
const elements = {
  loginOverlay: document.getElementById('login-overlay') as HTMLDivElement,
  btnLogin: document.getElementById('btn-login') as HTMLButtonElement,
  inputClientId: document.getElementById('input-client-id') as HTMLInputElement,
  inputStaffId: document.getElementById('input-staff-id') as HTMLInputElement,
  usageIndicator: document.getElementById('usage-indicator') as HTMLSpanElement,
  btnExport: document.getElementById('btn-export') as HTMLButtonElement,

  previewContainer: document.getElementById('preview-container') as HTMLDivElement,
  previewPlayerA: document.getElementById('preview-player-a') as HTMLVideoElement,
  previewPlayerB: document.getElementById('preview-player-b') as HTMLVideoElement,
  transitionOverlay: document.getElementById('transition-overlay') as HTMLDivElement,
  previewTransitionIndicator: document.getElementById('preview-transition-indicator') as HTMLDivElement,
  previewTransitionName: document.getElementById('preview-transition-name') as HTMLSpanElement,
  overlayContainer: document.getElementById('overlay-container') as HTMLDivElement,

  // Teleprompter on-stage elements
  prompterStageContainer: document.getElementById('prompter-stage-container') as HTMLDivElement,
  prompterCameraVideo: document.getElementById('prompter-camera-video') as HTMLVideoElement,
  prompterStageScrollArea: document.getElementById('prompter-stage-scroll-area') as HTMLDivElement,
  prompterStageScrollText: document.getElementById('prompter-stage-scroll-text') as HTMLDivElement,
  btnPrompterFontMinus: document.getElementById('btn-prompter-font-minus') as HTMLButtonElement,
  btnPrompterFontPlus: document.getElementById('btn-prompter-font-plus') as HTMLButtonElement,
  prompterFontSizeLabel: document.getElementById('prompter-font-size-label') as HTMLSpanElement,
  btnPrompterStageClose: document.getElementById('btn-prompter-stage-close') as HTMLButtonElement,
  btnPrompterRecord: document.getElementById('btn-prompter-record') as HTMLButtonElement,
  prompterRecordInner: document.getElementById('prompter-record-inner') as HTMLDivElement,
  prompterRecordTimer: document.getElementById('prompter-record-timer') as HTMLDivElement,

  // Playback Controls
  btnPlayPause: document.getElementById('btn-play-pause') as HTMLButtonElement,
  iconPlay: document.getElementById('icon-play') as unknown as SVGElement,
  iconPause: document.getElementById('icon-pause') as unknown as SVGElement,
  currentTimeDisplay: document.getElementById('current-time-display') as HTMLSpanElement,
  totalTimeDisplay: document.getElementById('total-time-display') as HTMLSpanElement,
  durationWarning: document.getElementById('duration-warning') as HTMLSpanElement,

  // Timeline
  timelineScroll: document.getElementById('timeline-scroll') as HTMLDivElement,
  timelineContent: document.getElementById('timeline-content') as HTMLDivElement,
  playhead: document.getElementById('playhead') as HTMLDivElement,
  rulerContent: document.getElementById('ruler-content') as HTMLDivElement,
  trackVideo: document.getElementById('video-sequence-container') as HTMLDivElement,
  trackText: document.getElementById('track-text') as HTMLDivElement,
  trackImage: document.getElementById('track-image') as HTMLDivElement,
  trackAudio: document.getElementById('track-audio') as HTMLDivElement,

  // Toolbar
  toolUpload: document.getElementById('tool-upload') as HTMLButtonElement,
  toolText: document.getElementById('tool-text') as HTMLButtonElement,
  toolImage: document.getElementById('tool-image') as HTMLButtonElement,
  toolPip: document.getElementById('tool-pip') as HTMLButtonElement,
  toolOverlayClip: document.getElementById('tool-overlay-clip') as HTMLButtonElement,
  toolTransition: document.getElementById('tool-transition') as HTMLButtonElement,
  toolMusic: document.getElementById('tool-music') as HTMLButtonElement,
  toolVo: document.getElementById('tool-vo') as HTMLButtonElement,
  toolTeleprompter: document.getElementById('tool-teleprompter') as HTMLButtonElement,
  toolTrim: document.getElementById('tool-trim') as HTMLButtonElement,
  toolDelete: document.getElementById('tool-delete') as HTMLButtonElement,

  // Inputs
  uploadInput: document.getElementById('upload-input') as HTMLInputElement,
  imageUploadInput: document.getElementById('image-upload-input') as HTMLInputElement,
  pipUploadInput: document.getElementById('pip-upload-input') as HTMLInputElement,
  overlayClipUploadInput: document.getElementById('overlay-clip-upload-input') as HTMLInputElement,
  btnInlineAdd: document.getElementById('btn-inline-add') as HTMLButtonElement,

  // Modals
  modalText: document.getElementById('modal-text') as HTMLDivElement,
  btnSaveText: document.getElementById('btn-save-text') as HTMLButtonElement,
  textOverlayInput: document.getElementById('text-overlay-input') as HTMLInputElement,

  modalTransition: document.getElementById('modal-transition') as HTMLDivElement,
  btnCloseTransition: document.getElementById('btn-close-transition') as HTMLButtonElement,
  btnApplyTransition: document.getElementById('btn-apply-transition') as HTMLButtonElement,
  btnPreviewTransition: document.getElementById('btn-preview-transition') as HTMLButtonElement,
  transitionDurationSlider: document.getElementById('transition-duration-slider') as HTMLInputElement,
  transitionDurationDisplay: document.getElementById('transition-duration-display') as HTMLSpanElement,

  // Delete Confirm Modal
  modalDeleteConfirm: document.getElementById('modal-delete-confirm') as HTMLDivElement,
  btnConfirmDelete: document.getElementById('btn-confirm-delete') as HTMLButtonElement,
  btnCancelDelete: document.getElementById('btn-cancel-delete') as HTMLButtonElement,
  deleteConfirmTitle: document.getElementById('delete-confirm-title') as HTMLHeadingElement,

  // Prompter Setup Modal
  modalTeleprompterSetup: document.getElementById('modal-teleprompter-setup') as HTMLDivElement,
  btnCloseTeleprompterSetup: document.getElementById('btn-close-teleprompter-setup') as HTMLButtonElement,
  prompterScriptInput: document.getElementById('prompter-script-input') as HTMLTextAreaElement,
  btnStartCameraPrompter: document.getElementById('btn-start-camera-prompter') as HTMLButtonElement,

  // Music Modal
  modalMusic: document.getElementById('modal-music') as HTMLDivElement,
  btnCloseMusic: document.getElementById('btn-close-music') as HTMLButtonElement,
  musicListContainer: document.getElementById('music-list-container') as HTMLDivElement,
  btnRemoveMusic: document.getElementById('btn-remove-music') as HTMLButtonElement,
  btnApplyMusic: document.getElementById('btn-apply-music') as HTMLButtonElement,

  // Master Admin
  btnAdminGear: document.getElementById('btn-admin-gear') as HTMLButtonElement,
  modalAdminPin: document.getElementById('modal-admin-pin') as HTMLDivElement,
  inputAdminPin: document.getElementById('input-admin-pin') as HTMLInputElement,
  adminPinError: document.getElementById('admin-pin-error') as HTMLParagraphElement,
  btnCancelAdminPin: document.getElementById('btn-cancel-admin-pin') as HTMLButtonElement,
  btnSubmitAdminPin: document.getElementById('btn-submit-admin-pin') as HTMLButtonElement,

  modalAdminDashboard: document.getElementById('modal-admin-dashboard') as HTMLDivElement,
  btnCloseAdminDashboard: document.getElementById('btn-close-admin-dashboard') as HTMLButtonElement,
  btnRefreshAdmin: document.getElementById('btn-refresh-admin') as HTMLButtonElement,
  adminTabContent: document.getElementById('admin-tab-content') as HTMLDivElement,
  beatUploadInput: document.getElementById('beat-upload-input') as HTMLInputElement,

  // Export
  modalExport: document.getElementById('modal-export') as HTMLDivElement,
  exportProgressBar: document.getElementById('export-progress-bar') as HTMLDivElement,
  exportStatusText: document.getElementById('export-status-text') as HTMLParagraphElement,
  exportProgressView: document.getElementById('export-progress-view') as HTMLDivElement,
  exportCompleteView: document.getElementById('export-complete-view') as HTMLDivElement,
  exportPreviewVideo: document.getElementById('export-preview-video') as HTMLVideoElement,
  exportCloudStatus: document.getElementById('export-cloud-status') as HTMLDivElement,
  exportCloudStatusText: document.getElementById('export-cloud-status-text') as HTMLSpanElement,
  exportLinkBox: document.getElementById('export-link-box') as HTMLDivElement,
  exportLinkText: document.getElementById('export-link-text') as HTMLParagraphElement,
  exportUploadError: document.getElementById('export-upload-error') as HTMLDivElement,
  exportUploadErrorMsg: document.getElementById('export-upload-error-msg') as HTMLParagraphElement,
  btnSaveToPhone: document.getElementById('btn-save-to-phone') as HTMLButtonElement,
  savePhoneNotice: document.getElementById('save-phone-notice') as HTMLDivElement,
  btnShareExport: document.getElementById('btn-share-export') as HTMLButtonElement,
  shareNotice: document.getElementById('share-notice') as HTMLDivElement,
  btnCopyExportLink: document.getElementById('btn-copy-export-link') as HTMLButtonElement,
  copyLinkBtnText: document.getElementById('copy-link-btn-text') as HTMLSpanElement,
  btnBackToEditing: document.getElementById('btn-back-to-editing') as HTMLButtonElement,
};

// --- INITIALIZATION ---
function init() {
  checkAuth();

  // Toolbar events
  elements.btnLogin.addEventListener('click', handleLogin);
  elements.toolUpload.addEventListener('click', () => elements.uploadInput.click());
  elements.btnInlineAdd.addEventListener('click', () => elements.uploadInput.click());
  elements.uploadInput.addEventListener('change', handleUpload);

  elements.toolImage?.addEventListener('click', () => elements.imageUploadInput.click());
  elements.imageUploadInput?.addEventListener('change', handleImageUpload);

  elements.toolPip?.addEventListener('click', () => elements.pipUploadInput.click());
  elements.pipUploadInput?.addEventListener('change', handlePipUpload);

  elements.toolOverlayClip?.addEventListener('click', () => elements.overlayClipUploadInput.click());
  elements.overlayClipUploadInput?.addEventListener('change', handleOverlayClipUpload);

  elements.btnPlayPause.addEventListener('click', togglePlay);
  elements.toolDelete.addEventListener('click', promptDeleteSelected);
  elements.btnConfirmDelete?.addEventListener('click', executeDeleteSelected);
  elements.btnCancelDelete?.addEventListener('click', () => elements.modalDeleteConfirm.classList.add('hidden'));

  elements.btnExport.addEventListener('click', handleExport);

  // Teleprompter events
  setupTeleprompter();

  // Text Overlay events
  elements.toolText.addEventListener('click', () => {
    elements.modalText.classList.remove('hidden');
    elements.textOverlayInput.focus();
  });
  elements.btnSaveText.addEventListener('click', handleAddText);
  setupTextPresetButtons();

  // Music events
  setupMusicSystem();

  // Voiceover events
  setupVoiceover();

  // Transition Controls
  setupTransitionControls();

  // Master Admin Section
  setupMasterSection();

  // Trim tool
  elements.toolTrim.addEventListener('click', handleTrimClick);

  // Keyboard shortcut for Delete
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      if (selectedItemId) {
        e.preventDefault();
        promptDeleteSelected();
      }
    }
  });

  // Drag Sort for Video Track
  new Sortable(elements.trackVideo, {
    draggable: '.video-clip-item',
    animation: 150,
    ghostClass: 'opacity-50',
    onEnd: () => {
      const domNodes = Array.from(elements.trackVideo.children).filter(el => el.hasAttribute('data-id'));
      const newSequence: VideoClip[] = [];
      domNodes.forEach(node => {
        const id = (node as HTMLElement).dataset.id;
        const clip = videoSequence.find(c => c.id === id);
        if (clip) newSequence.push(clip);
      });
      videoSequence = newSequence;
      renderTimeline();
      updatePlayheadAndPreview();
    }
  });

  // Scrubbing via Scroll
  elements.timelineScroll.addEventListener('scroll', handleTimelineScroll);
}

function checkAuth() {
  if (currentClientId && currentStaffId) {
    elements.loginOverlay.classList.add('hidden');
    renderTimeline();
    // Keep storage small: clean up exports & clips older than 48 hours for this staff member
    cleanupOldStaffExports(currentClientId, currentStaffId);
    cleanupOldStaffClips(currentClientId, currentStaffId);
  } else {
    elements.loginOverlay.classList.remove('hidden');
  }
}

function handleLogin() {
  const cid = elements.inputClientId.value.trim() || 'demo_client';
  const sid = elements.inputStaffId.value.trim() || 'demo_staff';
  currentClientId = cid;
  currentStaffId = sid;
  sessionStorage.setItem('vidhub_client_id', cid);
  sessionStorage.setItem('vidhub_staff_id', sid);
  checkAuth();
}

// --- DATA & UPLOAD ---
async function handleUpload(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;

  const files = Array.from(target.files);
  if (videoSequence.length + files.length > CONFIG.maxClips) {
    alert(`Cap reached: Max ${CONFIG.maxClips} active clips allowed per workspace.`);
    target.value = '';
    return;
  }

  for (const file of files) {
    const url = URL.createObjectURL(file);
    const duration = await getVideoDuration(url);
    const clipId = `vid_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const clip: VideoClip = {
      id: clipId,
      file,
      url,
      duration,
      trimStart: 0,
      trimEnd: duration,
      name: file.name
    };
    videoSequence.push(clip);

    // Save to Supabase storage and table in background
    uploadClipToSupabase(currentClientId, currentStaffId, clipId, file, duration).then(res => {
      clip.fileUrl = res.fileUrl;
    });
  }

  target.value = '';
  // Automatically select newly added clip
  if (videoSequence.length > 0) {
    selectItem(videoSequence[videoSequence.length - 1].id, 'video');
  }
  renderTimeline();
}

// --- IMAGE OVERLAYS WITH SHAPE FRAMES ---
async function handleImageUpload(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;
  const file = target.files[0];
  const url = URL.createObjectURL(file);

  const totalDur = getTotalDuration();
  const initDur = totalDur > 0 ? Math.min(4, Math.max(0.5, totalDur - currentGlobalTime)) : 4;

  const imgOverlay: OverlayClip = {
    id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type: 'image',
    file,
    content: url,
    shape: 'rectangle', // default
    startTime: currentGlobalTime,
    duration: Math.max(0.5, initDur),
    x: 25,
    y: 25,
    width: 50,
    height: 50
  };

  overlays.push(imgOverlay);
  target.value = '';
  selectItem(imgOverlay.id, 'overlay');
  renderTimeline();
  updatePlayheadAndPreview();
}

// --- PICTURE-IN-PICTURE (PiP) VIDEO ---
async function handlePipUpload(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;
  const file = target.files[0];
  const url = URL.createObjectURL(file);
  const dur = await getVideoDuration(url);

  const totalDur = getTotalDuration();
  const initDur = totalDur > 0 ? Math.min(dur, Math.max(0.5, totalDur - currentGlobalTime)) : Math.min(dur, 10);

  const pipOverlay: OverlayClip = {
    id: `pip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type: 'image', // reuse overlay engine with video tag or specialized overlay
    file,
    content: url,
    style: 'pip',
    shape: 'rectangle',
    startTime: currentGlobalTime,
    duration: Math.max(0.5, initDur),
    x: 60,
    y: 10,
    width: 35,
    height: 35,
    isVideo: true,
    isMuted: true
  };

  overlays.push(pipOverlay);
  target.value = '';
  selectItem(pipOverlay.id, 'overlay');
  renderTimeline();
  updatePlayheadAndPreview();
}

// --- NEW TOOL: OVERLAY CLIP (PICTURE OR VIDEO, ANY LENGTH UP TO FULL TIMELINE) ---
async function handleOverlayClipUpload(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;
  const file = target.files[0];
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video/');

  let naturalDur = 5;
  if (isVideo) {
    naturalDur = await getVideoDuration(url);
  }

  const totalDur = getTotalDuration();
  // Length can default to natural duration or up to full remaining timeline, adjustable up to full timeline
  const remainingTimeline = totalDur > 0 ? Math.max(0.5, totalDur - currentGlobalTime) : naturalDur;
  const initDur = isVideo 
    ? Math.min(naturalDur, remainingTimeline) 
    : (totalDur > 0 ? remainingTimeline : 5);

  const overlayClip: OverlayClip = {
    id: `ovclip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type: 'overlay_clip',
    file,
    content: url,
    style: 'overlay_clip',
    shape: 'rectangle',
    startTime: currentGlobalTime,
    duration: Math.max(0.5, initDur),
    x: 25,
    y: 25,
    width: 45,
    height: 45,
    isVideo,
    isMuted: true // default muted, with toggle to unmute
  };

  overlays.push(overlayClip);
  target.value = '';
  selectItem(overlayClip.id, 'overlay');
  renderTimeline();
  updatePlayheadAndPreview();
}

function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.src = url;
    v.onloadedmetadata = () => resolve(v.duration || 5);
    v.onerror = () => resolve(5);
  });
}

// --- TIMELINE CALCULATIONS & RENDERING ---
function getTotalDuration() {
  return videoSequence.reduce((acc, clip) => acc + (clip.trimEnd - clip.trimStart), 0);
}

function getSnapPoints(excludeOverlayId?: string): number[] {
  const points = new Set<number>();
  points.add(0);
  const total = getTotalDuration();
  if (total > 0) points.add(total);
  if (currentGlobalTime >= 0 && currentGlobalTime <= total) {
    points.add(currentGlobalTime);
  }

  let accum = 0;
  for (const clip of videoSequence) {
    const dur = clip.trimEnd - clip.trimStart;
    points.add(accum);
    accum += dur;
    points.add(accum);
  }

  for (const ov of overlays) {
    if (ov.id === excludeOverlayId) continue;
    points.add(ov.startTime);
    points.add(ov.startTime + ov.duration);
  }

  return Array.from(points);
}

function snapTimeToPoints(proposedTime: number, duration: number, snapPoints: number[]): number {
  const SNAP_THRESHOLD_SEC = 6 / PX_PER_SEC; // ~0.3s soft snap
  let bestDiff = SNAP_THRESHOLD_SEC;
  let snapped = proposedTime;
  let hasSnapped = false;

  for (const p of snapPoints) {
    const diff = Math.abs(proposedTime - p);
    if (diff < bestDiff) {
      bestDiff = diff;
      snapped = p;
      hasSnapped = true;
    }
  }

  if (!hasSnapped) {
    for (const p of snapPoints) {
      const targetStart = p - duration;
      const diff = Math.abs(proposedTime - targetStart);
      if (diff < bestDiff) {
        bestDiff = diff;
        snapped = targetStart;
      }
    }
  }

  return snapped;
}

function renderTimeline() {
  const totalDur = getTotalDuration();

  // Update Header usage & warning
  elements.usageIndicator.textContent = `${videoSequence.length}/${CONFIG.maxClips} Clips`;
  elements.totalTimeDisplay.textContent = formatTime(totalDur);
  if (totalDur >= 30) {
    elements.durationWarning.classList.remove('hidden');
    elements.totalTimeDisplay.classList.add('text-amber-500');
  } else {
    elements.durationWarning.classList.add('hidden');
    elements.totalTimeDisplay.classList.remove('text-amber-500');
  }

  elements.btnExport.disabled = videoSequence.length === 0;

  // Calculate width
  const totalPx = Math.max(totalDur * PX_PER_SEC, window.innerWidth);
  elements.timelineContent.style.width = `${totalPx + 150}px`;

  // Render Ruler
  let rulerHtml = '';
  for (let i = 0; i <= Math.ceil(totalDur) + 5; i++) {
    rulerHtml += `<div class="absolute border-l border-zinc-700 h-2" style="left: ${i * PX_PER_SEC}px;">
      <span class="absolute top-2 -left-2">${i % 5 === 0 ? i + 's' : ''}</span>
    </div>`;
  }
  elements.rulerContent.innerHTML = rulerHtml;

  // Render Video Track
  elements.trackVideo.innerHTML = '';

  videoSequence.forEach((clip, index) => {
    const width = (clip.trimEnd - clip.trimStart) * PX_PER_SEC;
    const isSelected = selectedItemId === clip.id;

    const div = document.createElement('div');
    div.dataset.id = clip.id;
    div.className = `video-clip-item h-full bg-zinc-800 relative cursor-pointer border ${isSelected ? 'border-white z-10 scale-[1.02] shadow-lg' : 'border-black'} flex-shrink-0 group overflow-hidden select-none transition-transform`;
    div.style.width = `${width}px`;

    div.innerHTML = `
      <video src="${clip.url}#t=${clip.trimStart}" class="w-full h-full object-cover opacity-60 pointer-events-none"></video>
      <div class="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] pointer-events-none"></div>
      <div class="absolute bottom-1 left-1.5 bg-black/75 backdrop-blur px-1.5 py-0.5 rounded text-[9px] font-medium text-zinc-300 pointer-events-none truncate max-w-[85%] border border-white/5">
        ${clip.name}
      </div>
    `;

    div.addEventListener('click', (e) => {
      e.stopPropagation();
      selectItem(clip.id, 'video');
    });

    elements.trackVideo.appendChild(div);

    // Transition icon between clips
    if (index < videoSequence.length - 1) {
      const transBtn = document.createElement('button');
      const isNone = globalTransition.type === 'none';
      transBtn.className = `z-20 -mx-3 self-center w-6 h-6 rounded-full ${isNone ? 'bg-zinc-800 border-zinc-700 text-zinc-400' : 'bg-blue-600 border-blue-400 text-white shadow-lg'} border flex items-center justify-center text-[10px] transition-all hover:scale-125 flex-shrink-0 cursor-pointer group`;
      transBtn.title = `Transition: ${getTransitionDisplayName(globalTransition.type)} (${globalTransition.duration}s)`;
      transBtn.innerHTML = `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12h16M14 6l6 6-6 6"/></svg>
      `;
      transBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTransitionModal();
      });
      elements.trackVideo.appendChild(transBtn);
    }
  });

  // Render Overlays
  elements.trackText.innerHTML = '';
  if (elements.trackImage) elements.trackImage.innerHTML = '';
  elements.trackAudio.innerHTML = '';

  // Render Music Track Bar if music selected
  if (selectedMusic && totalDur > 0) {
    const musicDiv = document.createElement('div');
    musicDiv.className = 'absolute top-0 bottom-0 bg-emerald-600/60 border border-emerald-400/40 rounded text-[10px] px-2 font-medium flex items-center text-white truncate cursor-pointer z-0';
    musicDiv.style.left = '0px';
    musicDiv.style.width = `${totalDur * PX_PER_SEC}px`;
    musicDiv.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1.5 shrink-0"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
      <span class="truncate">♫ ${selectedMusic.title} (Looped)</span>
    `;
    musicDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      openMusicModal();
    });
    elements.trackAudio.appendChild(musicDiv);
  }

  overlays.forEach(overlay => {
    const width = overlay.duration * PX_PER_SEC;
    const left = overlay.startTime * PX_PER_SEC;
    const isSelected = selectedItemId === overlay.id;

    const div = document.createElement('div');
    div.className = `absolute h-full rounded text-[10px] px-1 font-medium flex items-center overflow-visible cursor-grab touch-none select-none ${isSelected ? 'border border-white shadow-lg ring-1 ring-white/50 z-30' : 'border border-transparent hover:border-white/30 z-10'}`;
    div.style.touchAction = 'none';
    div.style.width = `${width}px`;
    div.style.left = `${left}px`;

    const innerContent = document.createElement('div');
    innerContent.className = 'w-full h-full flex items-center overflow-hidden rounded pointer-events-none select-none';

    const contentSpan = document.createElement('span');
    contentSpan.className = 'truncate select-none pointer-events-none w-full px-1';

    if (overlay.type === 'text') {
      div.classList.add('bg-blue-600/80', 'text-white');
      contentSpan.textContent = overlay.content || 'Text';
      innerContent.appendChild(contentSpan);
      div.appendChild(innerContent);
      elements.trackText.appendChild(div);
    } else if (overlay.type === 'overlay_clip') {
      div.classList.add(overlay.isVideo ? 'bg-cyan-600/80' : 'bg-teal-600/80', 'text-white');
      const soundBadge = overlay.isVideo ? (overlay.isMuted !== false ? ' [🔇]' : ' [🔊]') : '';
      contentSpan.textContent = `Overlay ${overlay.isVideo ? 'Video' : 'Pic'}${soundBadge}`;
      innerContent.appendChild(contentSpan);
      div.appendChild(innerContent);
      if (elements.trackImage) {
        elements.trackImage.appendChild(div);
      } else {
        elements.trackText.appendChild(div);
      }
    } else if (overlay.type === 'image') {
      div.classList.add(overlay.style === 'pip' ? 'bg-purple-600/80' : 'bg-amber-600/80', 'text-white');
      const pipSoundBadge = overlay.style === 'pip' ? (overlay.isMuted !== false ? ' [🔇]' : ' [🔊]') : '';
      contentSpan.textContent = overlay.style === 'pip' ? `PiP Video${pipSoundBadge}` : `Image [${getShapeIcon(overlay.shape || 'rectangle')}]`;
      innerContent.appendChild(contentSpan);
      div.appendChild(innerContent);
      if (elements.trackImage) {
        elements.trackImage.appendChild(div);
      } else {
        elements.trackText.appendChild(div);
      }
    } else if (overlay.type === 'voiceover') {
      div.classList.add('bg-red-600/80', 'text-white');
      contentSpan.textContent = 'Voiceover';
      innerContent.appendChild(contentSpan);
      div.appendChild(innerContent);
      elements.trackAudio.appendChild(div);
    }

    div.addEventListener('click', (e) => {
      e.stopPropagation();
      lastItemInteractionTime = Date.now();
    });

    // Pointer-based body dragging (moves block left and right along timeline)
    div.addEventListener('pointerdown', (e: PointerEvent) => {
      // If clicking resize handle, ignore body drag
      if ((e.target as HTMLElement).closest('.overlay-resize-handle')) {
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      e.stopPropagation();
      e.preventDefault();
      lastItemInteractionTime = Date.now();

      const dragStartX = e.clientX;
      const origStartTime = overlay.startTime;
      let hasMoved = false;

      // Lock timeline horizontal scroll so phone gestures move the block without scrolling
      elements.timelineScroll.style.overflowX = 'hidden';
      elements.timelineScroll.style.touchAction = 'none';

      // Floating live timestamp badge
      let timeBadge: HTMLDivElement | null = null;

      const onPointerMove = (ev: PointerEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        const deltaX = ev.clientX - dragStartX;

        if (!hasMoved && Math.abs(deltaX) > 2) {
          hasMoved = true;
          div.classList.add('cursor-grabbing', 'opacity-90', 'ring-2', 'ring-white', 'shadow-2xl', 'z-50');

          timeBadge = document.createElement('div');
          timeBadge.className = 'absolute -top-6 left-1/2 -translate-x-1/2 bg-blue-600 text-white font-mono text-[9px] px-1.5 py-0.5 rounded shadow pointer-events-none whitespace-nowrap z-50 border border-white/20';
          div.appendChild(timeBadge);
        }

        if (hasMoved) {
          const deltaTime = deltaX / PX_PER_SEC;
          let proposedStart = origStartTime + deltaTime;

          // Soft snapping to clip boundaries, playhead, 0:00, video end
          const snapPoints = getSnapPoints(overlay.id);
          proposedStart = snapTimeToPoints(proposedStart, overlay.duration, snapPoints);

          // Clamping: cannot go before 0:00 or past the end of the video
          const maxStart = totalDur > 0 ? Math.max(0, totalDur - Math.min(totalDur, overlay.duration)) : 300;
          proposedStart = Math.max(0, Math.min(maxStart, proposedStart));

          overlay.startTime = proposedStart;
          div.style.left = `${proposedStart * PX_PER_SEC}px`;

          if (timeBadge) {
            timeBadge.textContent = `${formatTime(proposedStart)} (${proposedStart.toFixed(1)}s)`;
          }

          // Live preview updates without rebuilding DOM
          updatePlayheadAndPreview();
        }
      };

      const onPointerUp = (ev: PointerEvent) => {
        ev.stopPropagation();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        elements.timelineScroll.style.overflowX = 'auto';
        elements.timelineScroll.style.touchAction = '';
        lastItemInteractionTime = Date.now();

        div.classList.remove('cursor-grabbing', 'opacity-90', 'ring-2', 'ring-white', 'shadow-2xl', 'z-50');
        if (timeBadge) {
          timeBadge.remove();
          timeBadge = null;
        }

        // Tapping or dragging selects item and triggers clean re-render
        selectItem(overlay.id, 'overlay');
      };

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    });

    // Left and Right resize handles when selected (stretches or shortens)
    if (isSelected) {
      // Left handle (stretches/shortens start time)
      const leftHandle = document.createElement('div');
      leftHandle.className = 'overlay-resize-handle absolute left-0 top-0 bottom-0 w-3.5 bg-black/50 hover:bg-black/70 cursor-ew-resize flex items-center justify-center touch-none z-30 select-none rounded-l';
      leftHandle.innerHTML = '<div class="w-1 h-3 bg-white rounded-full pointer-events-none shadow-sm"></div>';

      leftHandle.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        lastItemInteractionTime = Date.now();

        elements.timelineScroll.style.overflowX = 'hidden';
        elements.timelineScroll.style.touchAction = 'none';

        const leftStartX = e.clientX;
        const leftOrigStart = overlay.startTime;
        const leftOrigEnd = overlay.startTime + overlay.duration;

        const onLeftMove = (ev: PointerEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
          const deltaX = ev.clientX - leftStartX;
          let proposedStart = leftOrigStart + (deltaX / PX_PER_SEC);

          const snapPoints = getSnapPoints(overlay.id);
          const SNAP_THRESHOLD_SEC = 6 / PX_PER_SEC;
          for (const p of snapPoints) {
            if (Math.abs(proposedStart - p) < SNAP_THRESHOLD_SEC) {
              proposedStart = p;
              break;
            }
          }

          const maxStart = leftOrigEnd - 0.4;
          proposedStart = Math.max(0, Math.min(maxStart, proposedStart));

          const newDuration = leftOrigEnd - proposedStart;
          overlay.startTime = proposedStart;
          overlay.duration = newDuration;

          div.style.left = `${proposedStart * PX_PER_SEC}px`;
          div.style.width = `${newDuration * PX_PER_SEC}px`;

          updatePlayheadAndPreview();
        };

        const onLeftUp = () => {
          window.removeEventListener('pointermove', onLeftMove);
          window.removeEventListener('pointerup', onLeftUp);
          window.removeEventListener('pointercancel', onLeftUp);
          elements.timelineScroll.style.overflowX = 'auto';
          elements.timelineScroll.style.touchAction = '';
          lastItemInteractionTime = Date.now();
          renderTimeline();
          updatePlayheadAndPreview();
        };

        window.addEventListener('pointermove', onLeftMove, { passive: false });
        window.addEventListener('pointerup', onLeftUp);
        window.addEventListener('pointercancel', onLeftUp);
      });

      div.appendChild(leftHandle);

      // Right handle (stretches/shortens duration)
      const rightHandle = document.createElement('div');
      rightHandle.className = 'overlay-resize-handle absolute right-0 top-0 bottom-0 w-3.5 bg-black/50 hover:bg-black/70 cursor-ew-resize flex items-center justify-center touch-none z-30 select-none rounded-r';
      rightHandle.innerHTML = '<div class="w-1 h-3 bg-white rounded-full pointer-events-none shadow-sm"></div>';

      rightHandle.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        lastItemInteractionTime = Date.now();

        elements.timelineScroll.style.overflowX = 'hidden';
        elements.timelineScroll.style.touchAction = 'none';

        const rightStartX = e.clientX;
        const rightOrigDur = overlay.duration;

        const onRightMove = (ev: PointerEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
          const deltaX = ev.clientX - rightStartX;
          let proposedDur = rightOrigDur + (deltaX / PX_PER_SEC);

          const snapPoints = getSnapPoints(overlay.id);
          const SNAP_THRESHOLD_SEC = 6 / PX_PER_SEC;
          for (const p of snapPoints) {
            const targetDur = p - overlay.startTime;
            if (targetDur > 0.4 && Math.abs(proposedDur - targetDur) < SNAP_THRESHOLD_SEC) {
              proposedDur = targetDur;
              break;
            }
          }

          const maxDur = totalDur > 0 ? Math.max(0.4, totalDur - overlay.startTime) : 3600;
          proposedDur = Math.max(0.4, Math.min(maxDur, proposedDur));

          overlay.duration = proposedDur;
          div.style.width = `${proposedDur * PX_PER_SEC}px`;

          updatePlayheadAndPreview();
        };

        const onRightUp = () => {
          window.removeEventListener('pointermove', onRightMove);
          window.removeEventListener('pointerup', onRightUp);
          window.removeEventListener('pointercancel', onRightUp);
          elements.timelineScroll.style.overflowX = 'auto';
          elements.timelineScroll.style.touchAction = '';
          lastItemInteractionTime = Date.now();
          renderTimeline();
          updatePlayheadAndPreview();
        };

        window.addEventListener('pointermove', onRightMove, { passive: false });
        window.addEventListener('pointerup', onRightUp);
        window.addEventListener('pointercancel', onRightUp);
      });

      div.appendChild(rightHandle);
    }
  });

  updatePlayheadAndPreview();
}

let lastItemInteractionTime = 0;

function selectItem(id: string | null, type: 'video' | 'overlay' | null) {
  lastItemInteractionTime = Date.now();
  selectedItemId = id;
  selectedItemType = type;

  if (id) {
    elements.toolDelete.disabled = false;
    elements.toolTrim.disabled = type !== 'video';
  } else {
    elements.toolDelete.disabled = true;
    elements.toolTrim.disabled = true;
  }

  // Re-render selection highlight on timeline
  renderTimeline();
}

// Clear selection on background click
document.addEventListener('click', (e) => {
  if (Date.now() - lastItemInteractionTime < 450) return;
  const target = e.target as HTMLElement;
  if (target.closest('#timeline-scroll') && !target.closest('#track-video > div') && !target.closest('#track-text > div') && !target.closest('#track-image > div') && !target.closest('#track-audio > div')) {
    selectItem(null, null);
  }
});

// --- ITEM 1: WORKING "DELETE CLIP" ---
function promptDeleteSelected() {
  if (!selectedItemId) return;
  const isVideo = selectedItemType === 'video';
  elements.deleteConfirmTitle.textContent = isVideo ? 'Delete this clip?' : 'Delete this item?';
  elements.modalDeleteConfirm.classList.remove('hidden');
}

async function executeDeleteSelected() {
  elements.modalDeleteConfirm.classList.add('hidden');
  if (!selectedItemId) return;

  if (selectedItemType === 'video') {
    const clipIndex = videoSequence.findIndex(c => c.id === selectedItemId);
    if (clipIndex === -1) return;

    const clip = videoSequence[clipIndex];

    // Release in-browser blob video URL
    if (clip.url && clip.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(clip.url); } catch {}
    }

    // Delete file from Supabase storage and table in background
    deleteClipFromSupabase(currentClientId, currentStaffId, clip.id, clip.fileUrl);

    // Remove from array and close gap
    videoSequence.splice(clipIndex, 1);

    const totalDur = getTotalDuration();
    if (videoSequence.length > 0) {
      // Neighbouring clip becomes selected
      const nextIndex = Math.min(clipIndex, videoSequence.length - 1);
      const neighbor = videoSequence[nextIndex];
      selectItem(neighbor.id, 'video');

      // Update playhead time to valid bound
      if (currentGlobalTime >= totalDur) {
        currentGlobalTime = Math.max(0, totalDur - 0.05);
      }
    } else {
      // Last clip was deleted: show empty state, reset playhead
      selectItem(null, null);
      currentGlobalTime = 0;
      elements.previewPlayerA.removeAttribute('src');
      elements.previewPlayerB.removeAttribute('src');
      delete elements.previewPlayerA.dataset.clipId;
      delete elements.previewPlayerB.dataset.clipId;
      elements.previewPlayerA.load();
      elements.previewPlayerB.load();
    }
  } else if (selectedItemType === 'overlay') {
    const ovIndex = overlays.findIndex(o => o.id === selectedItemId);
    if (ovIndex !== -1) {
      const ov = overlays[ovIndex];
      if (ov.content && ov.content.startsWith('blob:')) {
        try { URL.revokeObjectURL(ov.content); } catch {}
      }
      overlays.splice(ovIndex, 1);
      selectItem(null, null);
    }
  }

  // Ensure app never enters broken state
  renderTimeline();
  updatePlayheadAndPreview();
}

// --- TRIM ACTION ---
function handleTrimClick() {
  if (!selectedItemId || selectedItemType !== 'video') return;
  const clip = videoSequence.find(c => c.id === selectedItemId);
  if (!clip) return;

  const currentDur = clip.trimEnd - clip.trimStart;
  const newTrim = prompt(`Trim Clip "${clip.name}":\nOriginal: ${clip.duration.toFixed(1)}s, Current: ${currentDur.toFixed(1)}s\nEnter new duration in seconds (1 to ${clip.duration.toFixed(1)}):`, currentDur.toFixed(1));
  if (newTrim) {
    const val = parseFloat(newTrim);
    if (!isNaN(val) && val > 0.5 && val <= clip.duration) {
      clip.trimStart = 0;
      clip.trimEnd = val;
      renderTimeline();
      updatePlayheadAndPreview();
    }
  }
}

// --- PLAYBACK ENGINE ---
function handleTimelineScroll() {
  if (!isPlaying) {
    const scrollLeft = elements.timelineScroll.scrollLeft;
    currentGlobalTime = scrollLeft / PX_PER_SEC;
    updatePlayheadAndPreview();
  }
}

function togglePlay() {
  if (videoSequence.length === 0) return;

  if (isPlaying) {
    isPlaying = false;
    elements.previewPlayerA.pause();
    elements.previewPlayerB.pause();
    bgMusicAudio.pause();
    cancelAnimationFrame(animationFrameId);
    elements.iconPlay.classList.remove('hidden');
    elements.iconPause.classList.add('hidden');
  } else {
    isPlaying = true;
    if (currentGlobalTime >= getTotalDuration()) {
      currentGlobalTime = 0;
      elements.timelineScroll.scrollLeft = 0;
    }
    elements.iconPlay.classList.add('hidden');
    elements.iconPause.classList.remove('hidden');

    updatePlayheadAndPreview();

    // Start background music if selected
    if (selectedMusic) {
      if (bgMusicAudio.src !== selectedMusic.url) {
        bgMusicAudio.src = selectedMusic.url;
      }
      bgMusicAudio.currentTime = currentGlobalTime % (selectedMusic.duration || 8);
      bgMusicAudio.play().catch(() => {});
    }

    if (elements.previewPlayerA.src && elements.previewPlayerA.style.opacity !== '0') {
      elements.previewPlayerA.play().catch(console.error);
    }
    if (elements.previewPlayerB.src && elements.previewPlayerB.style.opacity !== '0') {
      elements.previewPlayerB.play().catch(console.error);
    }

    lastTimestamp = performance.now();
    playbackLoop(lastTimestamp);
  }
}

let lastTimestamp = 0;
function playbackLoop(timestamp: number) {
  if (!isPlaying) return;

  const delta = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  currentGlobalTime += delta;
  const total = getTotalDuration();

  if (currentGlobalTime >= total) {
    currentGlobalTime = total;
    togglePlay(); // pause
  }

  elements.timelineScroll.scrollLeft = currentGlobalTime * PX_PER_SEC;
  updatePlayheadAndPreview();

  if (isPlaying) {
    animationFrameId = requestAnimationFrame(playbackLoop);
  }
}

function updatePlayheadAndPreview() {
  elements.currentTimeDisplay.textContent = formatTime(currentGlobalTime);
  elements.playhead.style.left = `${currentGlobalTime * PX_PER_SEC}px`;

  if (videoSequence.length === 0) {
    elements.previewPlayerA.removeAttribute('src');
    elements.previewPlayerB.removeAttribute('src');
    delete elements.previewPlayerA.dataset.clipId;
    delete elements.previewPlayerB.dataset.clipId;
    elements.previewPlayerA.load();
    elements.previewPlayerB.load();
    elements.transitionOverlay.style.opacity = '0';
    elements.previewTransitionIndicator.style.opacity = '0';
    renderActiveOverlays();
    return;
  }

  // Precompute clip timeline intervals
  const clipRanges: { clip: VideoClip; start: number; end: number; duration: number }[] = [];
  let accum = 0;
  for (const clip of videoSequence) {
    const dur = clip.trimEnd - clip.trimStart;
    clipRanges.push({
      clip,
      start: accum,
      end: accum + dur,
      duration: dur
    });
    accum += dur;
  }
  const totalDur = accum;

  // Check if in transition window
  let inTransition = false;
  let transIndex = -1;
  let transProgress = 0;

  if (globalTransition.type !== 'none' && clipRanges.length > 1) {
    for (let i = 0; i < clipRanges.length - 1; i++) {
      const boundaryTime = clipRanges[i].end;
      const maxAllowedT = Math.min(clipRanges[i].duration * 0.8, clipRanges[i + 1].duration * 0.8, 1.5);
      const effectiveT = Math.min(globalTransition.duration, maxAllowedT);
      const tStart = boundaryTime - effectiveT / 2;
      const tEnd = boundaryTime + effectiveT / 2;

      if (currentGlobalTime >= tStart && currentGlobalTime <= tEnd) {
        inTransition = true;
        transIndex = i;
        transProgress = effectiveT > 0 ? (currentGlobalTime - tStart) / effectiveT : 0;
        transProgress = Math.max(0, Math.min(1, transProgress));
        break;
      }
    }
  }

  if (inTransition && transIndex >= 0) {
    // In transition between clipA and clipB
    const clipA = clipRanges[transIndex].clip;
    const clipB = clipRanges[transIndex + 1].clip;
    const p = transProgress;

    const playerA = (transIndex % 2 === 0) ? elements.previewPlayerA : elements.previewPlayerB;
    const playerB = (transIndex % 2 === 0) ? elements.previewPlayerB : elements.previewPlayerA;

    if (playerA.dataset.clipId !== clipA.id) {
      playerA.dataset.clipId = clipA.id;
      playerA.src = clipA.url;
    }
    if (playerB.dataset.clipId !== clipB.id) {
      playerB.dataset.clipId = clipB.id;
      playerB.src = clipB.url;
    }

    const localA = Math.min(clipA.trimEnd, Math.max(clipA.trimStart, clipA.trimStart + (currentGlobalTime - clipRanges[transIndex].start)));
    const localB = Math.min(clipB.trimEnd, Math.max(clipB.trimStart, clipB.trimStart + (currentGlobalTime - clipRanges[transIndex + 1].start)));

    if (!isPlaying || Math.abs(playerA.currentTime - localA) > 0.25) {
      playerA.currentTime = localA;
    }
    if (!isPlaying || Math.abs(playerB.currentTime - localB) > 0.25) {
      playerB.currentTime = localB;
    }

    if (isPlaying) {
      if (playerA.paused && p < 0.95) playerA.play().catch(() => {});
      if (playerB.paused && (p > 0.1 || globalTransition.type === 'crossfade' || globalTransition.type === 'slide')) {
        playerB.play().catch(() => {});
      }
    }

    elements.previewTransitionIndicator.style.opacity = '1';
    elements.previewTransitionName.textContent = getTransitionDisplayName(globalTransition.type);

    // Apply animation effect
    if (globalTransition.type === 'fade') {
      elements.transitionOverlay.style.backgroundColor = '#000000';
      if (p < 0.5) {
        const subP = p / 0.5;
        playerA.style.opacity = '1';
        playerB.style.opacity = '0';
        elements.transitionOverlay.style.opacity = `${subP}`;
        playerA.volume = Math.max(0, 1 - subP);
        playerB.volume = 0;
      } else {
        const subP = (p - 0.5) / 0.5;
        playerA.style.opacity = '0';
        playerB.style.opacity = '1';
        elements.transitionOverlay.style.opacity = `${1 - subP}`;
        playerA.volume = 0;
        playerB.volume = Math.min(1, subP);
      }
    } else if (globalTransition.type === 'crossfade') {
      elements.transitionOverlay.style.opacity = '0';
      playerA.style.opacity = `${1 - p}`;
      playerB.style.opacity = `${p}`;
      playerA.volume = Math.max(0, 1 - p);
      playerB.volume = Math.min(1, p);
    } else if (globalTransition.type === 'white') {
      elements.transitionOverlay.style.backgroundColor = '#ffffff';
      if (p < 0.5) {
        const subP = p / 0.5;
        playerA.style.opacity = '1';
        playerB.style.opacity = '0';
        elements.transitionOverlay.style.opacity = `${subP}`;
      } else {
        const subP = (p - 0.5) / 0.5;
        playerA.style.opacity = '0';
        playerB.style.opacity = '1';
        elements.transitionOverlay.style.opacity = `${1 - subP}`;
      }
    } else if (globalTransition.type === 'slide') {
      elements.transitionOverlay.style.opacity = '0';
      playerA.style.opacity = '1';
      playerB.style.opacity = '1';
      playerA.style.transform = `translateX(${-p * 100}%)`;
      playerB.style.transform = `translateX(${(1 - p) * 100}%)`;
    } else if (globalTransition.type === 'zoom') {
      elements.transitionOverlay.style.opacity = '0';
      playerA.style.opacity = `${1 - p}`;
      playerB.style.opacity = `${p}`;
      playerA.style.transform = `scale(${1 + p * 0.15})`;
      playerB.style.transform = `scale(${1.15 - p * 0.15})`;
    }
  } else {
    // Normal single-clip playback
    elements.transitionOverlay.style.opacity = '0';
    elements.previewTransitionIndicator.style.opacity = '0';

    let activeIdx = 0;
    for (let i = 0; i < clipRanges.length; i++) {
      if (currentGlobalTime >= clipRanges[i].start && currentGlobalTime < clipRanges[i].end) {
        activeIdx = i;
        break;
      }
    }
    if (currentGlobalTime >= totalDur && clipRanges.length > 0) {
      activeIdx = clipRanges.length - 1;
    }

    const activeRange = clipRanges[activeIdx];
    const clip = activeRange.clip;
    const localClipTime = Math.min(clip.trimEnd, Math.max(clip.trimStart, clip.trimStart + (currentGlobalTime - activeRange.start)));

    const activePlayer = (activeIdx % 2 === 0) ? elements.previewPlayerA : elements.previewPlayerB;
    const inactivePlayer = (activeIdx % 2 === 0) ? elements.previewPlayerB : elements.previewPlayerA;

    activePlayer.style.opacity = '1';
    activePlayer.style.transform = 'none';
    activePlayer.volume = 1;

    if (activePlayer.dataset.clipId !== clip.id) {
      activePlayer.dataset.clipId = clip.id;
      activePlayer.src = clip.url;
      if (isPlaying) {
        activePlayer.play().catch(console.error);
      }
    }

    if (!isPlaying || Math.abs(activePlayer.currentTime - localClipTime) > 0.2) {
      activePlayer.currentTime = localClipTime;
    }

    inactivePlayer.style.opacity = '0';
    inactivePlayer.style.transform = 'none';
    inactivePlayer.volume = 0;
    if (!inactivePlayer.paused) inactivePlayer.pause();

    // Preload next clip
    if (activeIdx + 1 < clipRanges.length) {
      const nextClip = clipRanges[activeIdx + 1].clip;
      if (inactivePlayer.dataset.clipId !== nextClip.id) {
        inactivePlayer.dataset.clipId = nextClip.id;
        inactivePlayer.src = nextClip.url;
        inactivePlayer.currentTime = nextClip.trimStart;
      }
    }
  }

  // Render active overlays (Text, Image with shapes, Voiceover, PiP)
  renderActiveOverlays();

  // Background Music auto-ducking during voiceover
  if (selectedMusic && isPlaying) {
    const isVoActive = overlays.some(o => o.type === 'voiceover' && currentGlobalTime >= o.startTime && currentGlobalTime < o.startTime + o.duration);
    bgMusicAudio.volume = isVoActive ? 0.2 : 0.6;
  }
}

// --- ITEM 3: SHAPE FRAMES & ON-STAGE DRAG/RESIZE FOR OVERLAYS ---
function renderActiveOverlays() {
  const currentlyActiveAudioIds = new Set<string>();
  const currentlyActiveOverlayIds = new Set<string>();

  // Determine active overlays
  overlays.forEach(overlay => {
    const isActive = currentGlobalTime >= overlay.startTime && currentGlobalTime < overlay.startTime + overlay.duration;
    if (isActive) currentlyActiveOverlayIds.add(overlay.id);
  });

  // Remove elements from overlayContainer that are no longer active
  const existingDomNodes = Array.from(elements.overlayContainer.children) as HTMLElement[];
  existingDomNodes.forEach(node => {
    const oid = node.dataset.overlayId;
    if (oid && !currentlyActiveOverlayIds.has(oid)) {
      node.remove();
    }
  });

  overlays.forEach(overlay => {
    const isActive = currentlyActiveOverlayIds.has(overlay.id);
    if (!isActive) return;

    if (overlay.type === 'text') {
      let wrapper = elements.overlayContainer.querySelector(`[data-overlay-id="${overlay.id}"]`) as HTMLDivElement | null;
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.dataset.overlayId = overlay.id;
        wrapper.className = 'absolute pointer-events-auto cursor-move select-none p-2 border border-dashed border-transparent hover:border-white/50 transition-colors';
        const div = document.createElement('div');
        div.className = 'text-white font-bold text-2xl text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]';
        div.textContent = overlay.content || '';
        setupStageDrag(wrapper, overlay);
        wrapper.appendChild(div);
        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          selectItem(overlay.id, 'overlay');
        });
        elements.overlayContainer.appendChild(wrapper);
      }

      wrapper.style.left = `${overlay.x !== undefined ? overlay.x : 50}%`;
      wrapper.style.top = `${overlay.y !== undefined ? overlay.y : 50}%`;
      wrapper.style.transform = 'translate(-50%, -50%)';

      const textDiv = wrapper.firstElementChild as HTMLElement;
      if (textDiv) {
        textDiv.textContent = overlay.content || '';
        if (overlay.style === 'Fade In') {
          const prog = currentGlobalTime - overlay.startTime;
          textDiv.style.opacity = Math.min(prog / 0.5, 1).toString();
        } else if (overlay.style === 'Slide') {
          const prog = Math.max(0, 40 - (currentGlobalTime - overlay.startTime) * 80);
          textDiv.style.transform = `translateY(${prog}px)`;
        } else {
          textDiv.style.opacity = '1';
          textDiv.style.transform = 'none';
        }
      }

    } else if (overlay.type === 'image' || overlay.type === 'overlay_clip') {
      const isVideoOverlay = overlay.style === 'pip' || overlay.isVideo === true;
      let wrapper = elements.overlayContainer.querySelector(`[data-overlay-id="${overlay.id}"]`) as HTMLDivElement | null;

      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.dataset.overlayId = overlay.id;
        wrapper.className = 'absolute pointer-events-auto cursor-move select-none group border border-dashed border-white/40 hover:border-white transition-all shadow-md';

        if (isVideoOverlay) {
          // Video player on stage (PiP or Overlay Clip video)
          const pipVideo = document.createElement('video');
          pipVideo.src = overlay.content || '';
          pipVideo.autoplay = isPlaying;
          pipVideo.muted = overlay.isMuted !== false;
          pipVideo.loop = true;
          pipVideo.playsInline = true;
          pipVideo.className = 'w-full h-full object-cover rounded-lg shadow-xl pointer-events-none';
          wrapper.appendChild(pipVideo);

          // Mute/unmute toggle in corner
          const muteBtn = document.createElement('button');
          const isMuted = overlay.isMuted !== false;
          muteBtn.className = `absolute -top-3 -left-3 w-7 h-7 rounded-full ${isMuted ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-600' : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400'} flex items-center justify-center text-xs shadow-xl border transition-all active:scale-90 z-30 cursor-pointer pointer-events-auto`;
          muteBtn.title = isMuted ? 'Audio Muted in export (Click to Unmute)' : 'Sound Included in export (Click to Mute)';
          muteBtn.innerHTML = isMuted
            ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
            : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
          muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            overlay.isMuted = !isMuted;
            renderTimeline();
            updatePlayheadAndPreview();
          });
          wrapper.appendChild(muteBtn);
        } else {
          // Image element
          const img = document.createElement('img');
          img.src = overlay.content || '';
          img.className = 'w-full h-full object-cover rounded-lg pointer-events-none';
          if (overlay.type === 'image') {
            img.style.clipPath = getShapeCssClipPath(overlay.shape || 'rectangle');
          }
          wrapper.appendChild(img);

          if (overlay.type === 'image') {
            // Corner shape toggle button: Rectangle -> Circle -> Heart -> Rectangle
            const shapeBtn = document.createElement('button');
            shapeBtn.className = 'absolute -top-3 -left-3 w-6 h-6 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center text-xs shadow-lg border border-white/20 transition-transform active:scale-90 z-30 cursor-pointer pointer-events-auto';
            shapeBtn.title = `Current Frame: ${overlay.shape || 'rectangle'} (Click to cycle)`;
            shapeBtn.innerHTML = `<span>${getShapeIcon(overlay.shape || 'rectangle')}</span>`;
            shapeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              overlay.shape = getNextShape(overlay.shape || 'rectangle');
              renderTimeline();
              updatePlayheadAndPreview();
            });
            wrapper.appendChild(shapeBtn);
          }
        }

        // Corner resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'absolute -bottom-2 -right-2 w-5 h-5 bg-white text-black rounded-full cursor-nwse-resize flex items-center justify-center shadow z-30 pointer-events-auto';
        resizeHandle.innerHTML = '<span class="text-[9px]">↘</span>';
        setupStageResize(resizeHandle, wrapper, overlay);
        wrapper.appendChild(resizeHandle);

        // Stage drag
        setupStageDrag(wrapper, overlay);

        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          selectItem(overlay.id, 'overlay');
        });

        elements.overlayContainer.appendChild(wrapper);
      }

      // Sync position and size
      const wPct = overlay.width || 40;
      const hPct = overlay.height || 40;
      wrapper.style.width = `${wPct}%`;
      wrapper.style.height = `${hPct}%`;
      wrapper.style.left = `${overlay.x !== undefined ? overlay.x : 30}%`;
      wrapper.style.top = `${overlay.y !== undefined ? overlay.y : 30}%`;

      if (isVideoOverlay) {
        const vid = wrapper.querySelector('video');
        if (vid) {
          vid.muted = overlay.isMuted !== false;
          const localTime = Math.max(0, currentGlobalTime - overlay.startTime);
          if (isPlaying) {
            if (vid.paused) vid.play().catch(() => {});
          } else {
            if (!vid.paused) vid.pause();
            if (Math.abs(vid.currentTime - localTime) > 0.25) {
              vid.currentTime = localTime % (vid.duration || 10);
            }
          }
        }
      }

    } else if (overlay.type === 'voiceover' && overlay.file) {
      currentlyActiveAudioIds.add(overlay.id);
      let audioEl = activeAudioNodes.get(overlay.id);
      if (!audioEl) {
        audioEl = new Audio(URL.createObjectURL(overlay.file));
        activeAudioNodes.set(overlay.id, audioEl);
      }

      const localTime = currentGlobalTime - overlay.startTime;
      if (isPlaying) {
        if (audioEl.paused) {
          audioEl.currentTime = localTime;
          audioEl.play().catch(console.error);
        } else if (Math.abs(audioEl.currentTime - localTime) > 0.25) {
          audioEl.currentTime = localTime;
        }
      } else {
        if (!audioEl.paused) audioEl.pause();
        audioEl.currentTime = localTime;
      }
    }
  });

  // Audio cleanup
  for (const [id, audioEl] of activeAudioNodes.entries()) {
    if (!currentlyActiveAudioIds.has(id)) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      activeAudioNodes.delete(id);
    }
  }
}

function setupStageDrag(el: HTMLElement, overlay: OverlayClip) {
  let isDragging = false;
  let startX = 0, startY = 0;
  let initLeft = 0, initTop = 0;

  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    isDragging = true;
    el.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;

    const parentRect = elements.previewContainer.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    initLeft = ((rect.left - parentRect.left) / parentRect.width) * 100;
    initTop = ((rect.top - parentRect.top) / parentRect.height) * 100;

    const onMove = (ev: PointerEvent) => {
      if (!isDragging) return;
      const dx = ((ev.clientX - startX) / parentRect.width) * 100;
      const dy = ((ev.clientY - startY) / parentRect.height) * 100;
      overlay.x = Math.max(0, Math.min(90, initLeft + dx));
      overlay.y = Math.max(0, Math.min(90, initTop + dy));
      el.style.left = `${overlay.x}%`;
      el.style.top = `${overlay.y}%`;
      if (overlay.type === 'text') el.style.transform = 'none';
    };

    const onUp = (ev: PointerEvent) => {
      isDragging = false;
      try { el.releasePointerCapture(ev.pointerId); } catch {}
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function setupStageResize(handle: HTMLElement, el: HTMLElement, overlay: OverlayClip) {
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    let isResizing = true;
    handle.setPointerCapture(e.pointerId);
    const parentRect = elements.previewContainer.getBoundingClientRect();
    const startX = e.clientX;
    const initW = overlay.width || 40;
    const initH = overlay.height || 40;

    const onMove = (ev: PointerEvent) => {
      if (!isResizing) return;
      const dx = ((ev.clientX - startX) / parentRect.width) * 100;
      const newW = Math.max(15, Math.min(90, initW + dx));
      const newH = Math.max(15, Math.min(90, initH + dx));
      overlay.width = newW;
      overlay.height = newH;
      el.style.width = `${newW}%`;
      el.style.height = `${newH}%`;
    };

    const onUp = (ev: PointerEvent) => {
      isResizing = false;
      try { handle.releasePointerCapture(ev.pointerId); } catch {}
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// --- ITEM 2: TELEPROMPTER ---
function setupTeleprompter() {
  elements.toolTeleprompter.addEventListener('click', () => {
    elements.modalTeleprompterSetup.classList.remove('hidden');
  });

  elements.btnCloseTeleprompterSetup.addEventListener('click', () => {
    elements.modalTeleprompterSetup.classList.add('hidden');
  });

  // Speed selector
  const speedBtns = document.querySelectorAll('.prompter-speed-btn');
  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      speedBtns.forEach(b => {
        b.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
        b.classList.add('bg-zinc-800', 'text-zinc-300');
      });
      btn.classList.remove('bg-zinc-800', 'text-zinc-300');
      btn.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
      prompterScrollSpeed = btn.getAttribute('data-speed') as any || 'normal';
    });
  });

  // Start Camera
  elements.btnStartCameraPrompter.addEventListener('click', startPrompterCamera);

  // Stage Font Controls
  elements.btnPrompterFontMinus.addEventListener('click', () => {
    prompterFontSize = Math.max(16, prompterFontSize - 2);
    elements.prompterFontSizeLabel.textContent = prompterFontSize.toString();
    elements.prompterStageScrollText.style.fontSize = `${prompterFontSize}px`;
  });

  elements.btnPrompterFontPlus.addEventListener('click', () => {
    prompterFontSize = Math.min(42, prompterFontSize + 2);
    elements.prompterFontSizeLabel.textContent = prompterFontSize.toString();
    elements.prompterStageScrollText.style.fontSize = `${prompterFontSize}px`;
  });

  // Close Stage
  elements.btnPrompterStageClose.addEventListener('click', stopPrompterStage);

  // Stage Record Button
  elements.btnPrompterRecord.addEventListener('click', togglePrompterRecord);
}

async function startPrompterCamera() {
  const scriptText = elements.prompterScriptInput.value.trim();
  elements.prompterStageScrollText.textContent = scriptText || 'Look straight into the lens. Speak clearly with natural pacing.';
  elements.modalTeleprompterSetup.classList.add('hidden');

  try {
    prompterStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } },
      audio: true
    });
    elements.prompterCameraVideo.srcObject = prompterStream;
    elements.prompterStageContainer.classList.remove('hidden');

    // Reset scroller position
    prompterScrollPos = 0;
    elements.prompterStageScrollText.style.transform = 'translateY(0px)';
  } catch (err: any) {
    alert("Camera/Mic access denied: " + (err.message || err));
  }
}

function stopPrompterStage() {
  if (prompterIsRecording) {
    stopPrompterRecording();
  }
  if (prompterStream) {
    prompterStream.getTracks().forEach(t => t.stop());
    prompterStream = null;
  }
  elements.prompterCameraVideo.srcObject = null;
  elements.prompterStageContainer.classList.add('hidden');
  cancelAnimationFrame(prompterScrollAnimId);
}

function togglePrompterRecord() {
  if (!prompterIsRecording) {
    startPrompterRecording();
  } else {
    stopPrompterRecording();
  }
}

function startPrompterRecording() {
  if (!prompterStream) return;
  prompterIsRecording = true;
  prompterChunks = [];

  // Important: MediaRecorder records the raw hardware stream, so script is never recorded
  try {
    prompterRecorder = new MediaRecorder(prompterStream, { mimeType: 'video/webm' });
  } catch {
    prompterRecorder = new MediaRecorder(prompterStream);
  }

  prompterRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) prompterChunks.push(e.data);
  };

  prompterRecorder.onstop = async () => {
    const recordedBlob = new Blob(prompterChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(recordedBlob);
    const duration = await getVideoDuration(url);

    if (videoSequence.length >= CONFIG.maxClips) {
      alert(`Clip cap reached (${CONFIG.maxClips}). Recording saved locally.`);
      return;
    }

    const newClipId = `vid_prompt_${Date.now()}`;
    const newClip: VideoClip = {
      id: newClipId,
      file: recordedBlob,
      url,
      duration: duration || 5,
      trimStart: 0,
      trimEnd: duration || 5,
      name: `Take ${prompterTakesCount++} (Prompter)`
    };

    videoSequence.push(newClip);
    uploadClipToSupabase(currentClientId, currentStaffId, newClipId, recordedBlob, duration);

    stopPrompterStage();
    selectItem(newClip.id, 'video');
    renderTimeline();
    updatePlayheadAndPreview();
  };

  prompterRecorder.start(100);

  // UI feedback on stage
  elements.prompterRecordInner.classList.remove('rounded-full', 'w-6', 'h-6');
  elements.prompterRecordInner.classList.add('rounded-sm', 'w-5', 'h-5', 'bg-red-500');
  elements.prompterRecordTimer.style.opacity = '1';

  prompterRecordSeconds = 0;
  elements.prompterRecordTimer.textContent = 'REC 00:00';
  prompterRecordTimerInterval = window.setInterval(() => {
    prompterRecordSeconds++;
    elements.prompterRecordTimer.textContent = `REC ${formatTime(prompterRecordSeconds)}`;
  }, 1000);

  // Start smooth scrolling of script
  startPrompterScroll();
}

function stopPrompterRecording() {
  if (!prompterIsRecording) return;
  prompterIsRecording = false;
  clearInterval(prompterRecordTimerInterval);
  cancelAnimationFrame(prompterScrollAnimId);

  elements.prompterRecordInner.classList.remove('rounded-sm', 'w-5', 'h-5', 'bg-red-500');
  elements.prompterRecordInner.classList.add('rounded-full', 'w-6', 'h-6', 'bg-white');
  elements.prompterRecordTimer.style.opacity = '0';

  if (prompterRecorder && prompterRecorder.state !== 'inactive') {
    prompterRecorder.stop();
  }
}

function startPrompterScroll() {
  let speedPxPerSec = 32;
  if (prompterScrollSpeed === 'slow') speedPxPerSec = 18;
  if (prompterScrollSpeed === 'fast') speedPxPerSec = 60;

  let lastTime = performance.now();
  const step = (now: number) => {
    if (!prompterIsRecording) return;
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    prompterScrollPos += speedPxPerSec * dt;
    elements.prompterStageScrollText.style.transform = `translateY(-${prompterScrollPos}px)`;
    prompterScrollAnimId = requestAnimationFrame(step);
  };
  prompterScrollAnimId = requestAnimationFrame(step);
}

// --- ITEM 4: MUSIC (BUILT-IN + ADMIN LIBRARY) ---
let previewAudioElement: HTMLAudioElement | null = null;
let currentPreviewBeatId: string | null = null;

function setupMusicSystem() {
  elements.toolMusic.addEventListener('click', openMusicModal);
  elements.btnCloseMusic.addEventListener('click', () => {
    stopMusicPreview();
    elements.modalMusic.classList.add('hidden');
  });

  elements.btnRemoveMusic.addEventListener('click', () => {
    selectedMusic = null;
    bgMusicAudio.pause();
    bgMusicAudio.removeAttribute('src');
    stopMusicPreview();
    elements.modalMusic.classList.add('hidden');
    renderTimeline();
  });

  elements.btnApplyMusic.addEventListener('click', () => {
    stopMusicPreview();
    elements.modalMusic.classList.add('hidden');
    renderTimeline();
  });
}

function stopMusicPreview() {
  if (previewAudioElement) {
    previewAudioElement.pause();
    previewAudioElement = null;
    currentPreviewBeatId = null;
  }
}

async function openMusicModal() {
  elements.musicListContainer.innerHTML = '<div class="text-xs text-zinc-400 p-4 text-center">Loading music library...</div>';
  elements.modalMusic.classList.remove('hidden');

  // 1. Fetch approved beats from Supabase
  const beats = await fetchApprovedBeats();

  // 2. Fetch built-in Web Audio API loops
  const builtinTracks = await getBuiltinTracks();

  elements.musicListContainer.innerHTML = '';

  const allAvailableTracks: { id: string; title: string; url: string; duration: number; isBuiltin: boolean }[] = [];

  // Add beats from Supabase
  beats.forEach(b => {
    allAvailableTracks.push({
      id: b.id,
      title: b.title,
      url: b.file_url,
      duration: b.duration_seconds || 30,
      isBuiltin: false
    });
  });

  // Add built-in loops (guarantees list is never empty)
  builtinTracks.forEach(bt => {
    allAvailableTracks.push({
      id: bt.id,
      title: bt.title,
      url: bt.url,
      duration: bt.duration,
      isBuiltin: true
    });
  });

  allAvailableTracks.forEach(track => {
    const isSelected = selectedMusic?.id === track.id;
    const card = document.createElement('div');
    card.className = `p-3 rounded-xl border ${isSelected ? 'border-blue-500 bg-blue-950/20' : 'border-zinc-800 bg-zinc-950'} flex items-center justify-between gap-3 transition-colors`;

    card.innerHTML = `
      <div class="flex items-center gap-3 overflow-hidden">
        <button class="btn-preview-beat w-9 h-9 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center shrink-0 transition-colors" data-id="${track.id}" data-url="${track.url}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        </button>
        <div class="truncate">
          <p class="text-xs font-semibold text-white truncate">${track.title}</p>
          <p class="text-[10px] text-zinc-400">${track.duration.toFixed(0)}s • ${track.isBuiltin ? 'Built-in Loop' : 'Curated Beat'}</p>
        </div>
      </div>
      <button class="btn-select-track text-xs px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0 ${isSelected ? 'bg-blue-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}" data-id="${track.id}">
        ${isSelected ? 'Selected' : 'Use'}
      </button>
    `;

    // Preview button
    const previewBtn = card.querySelector('.btn-preview-beat') as HTMLButtonElement;
    previewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentPreviewBeatId === track.id && previewAudioElement && !previewAudioElement.paused) {
        stopMusicPreview();
        previewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      } else {
        stopMusicPreview();
        previewAudioElement = new Audio(track.url);
        previewAudioElement.play().catch(console.error);
        currentPreviewBeatId = track.id;
        previewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
        previewAudioElement.onended = () => {
          previewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        };
      }
    });

    // Select button
    const selectBtn = card.querySelector('.btn-select-track') as HTMLButtonElement;
    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedMusic = {
        id: track.id,
        title: track.title,
        url: track.url,
        duration: track.duration
      };
      stopMusicPreview();
      openMusicModal(); // refresh selection state
    });

    elements.musicListContainer.appendChild(card);
  });
}

// --- ITEM 5: MASTER SECTION (ADMIN ONLY) ---
let currentAdminTab = 'clients';

function setupMasterSection() {
  elements.btnAdminGear.addEventListener('click', () => {
    elements.inputAdminPin.value = '';
    elements.adminPinError.classList.add('hidden');
    elements.modalAdminPin.classList.remove('hidden');
    elements.inputAdminPin.focus();
  });

  elements.btnCancelAdminPin.addEventListener('click', () => {
    elements.modalAdminPin.classList.add('hidden');
  });

  elements.btnSubmitAdminPin.addEventListener('click', verifyAdminPin);
  elements.inputAdminPin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyAdminPin();
  });

  elements.btnCloseAdminDashboard.addEventListener('click', () => {
    elements.modalAdminDashboard.classList.add('hidden');
  });

  elements.btnRefreshAdmin.addEventListener('click', renderAdminDashboardTab);

  const adminTabs = document.querySelectorAll('.admin-tab-btn');
  adminTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      adminTabs.forEach(t => {
        t.classList.remove('border-blue-500', 'text-white');
        t.classList.add('border-transparent', 'text-zinc-400');
      });
      tab.classList.remove('border-transparent', 'text-zinc-400');
      tab.classList.add('border-blue-500', 'text-white');
      currentAdminTab = tab.getAttribute('data-tab') || 'clients';
      renderAdminDashboardTab();
    });
  });

  elements.beatUploadInput.addEventListener('change', handleAdminBeatUpload);
}

function verifyAdminPin() {
  const entered = elements.inputAdminPin.value.trim();
  if (entered === MASTER_PIN) {
    elements.modalAdminPin.classList.add('hidden');
    elements.modalAdminDashboard.classList.remove('hidden');
    renderAdminDashboardTab();
  } else {
    elements.adminPinError.classList.remove('hidden');
  }
}

async function renderAdminDashboardTab() {
  elements.adminTabContent.innerHTML = '<div class="text-xs text-zinc-400 p-8 text-center">Loading master data from Supabase...</div>';

  const { clips, projects } = await fetchMasterAnalytics();

  if (currentAdminTab === 'clients') {
    // 1. Per-client overview
    const clientMap = new Map<string, { staffSet: Set<string>; clipCount: number; exportCount: number }>();

    // Seed current client as active
    clientMap.set(currentClientId || 'demo_client', { staffSet: new Set([currentStaffId || 'demo_staff']), clipCount: videoSequence.length, exportCount: 1 });

    clips.forEach((c: any) => {
      const cid = c.client_id || 'unknown';
      if (!clientMap.has(cid)) {
        clientMap.set(cid, { staffSet: new Set(), clipCount: 0, exportCount: 0 });
      }
      const data = clientMap.get(cid)!;
      if (c.staff_id) data.staffSet.add(c.staff_id);
      data.clipCount++;
    });

    projects.forEach((p: any) => {
      const cid = p.client_id || 'unknown';
      if (!clientMap.has(cid)) {
        clientMap.set(cid, { staffSet: new Set(), clipCount: 0, exportCount: 0 });
      }
      clientMap.get(cid)!.exportCount++;
    });

    let html = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <h3 class="text-sm font-semibold text-white">Client Portfolio Overview</h3>
          <span class="text-xs text-zinc-400">${clientMap.size} Active Client Workspaces</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    `;

    clientMap.forEach((info, cid) => {
      html += `
        <div class="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
          <div class="flex justify-between items-center">
            <span class="font-bold text-sm text-blue-400">${cid}</span>
            <span class="text-[10px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full font-mono">${info.staffSet.size} Staff</span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-zinc-900">
            <div>
              <span class="text-zinc-500 block text-[10px]">Clips Uploaded</span>
              <span class="font-semibold text-white">${info.clipCount}</span>
            </div>
            <div>
              <span class="text-zinc-500 block text-[10px]">Projects Exported</span>
              <span class="font-semibold text-white">${info.exportCount}</span>
            </div>
          </div>
        </div>
      `;
    });

    html += `</div></div>`;
    elements.adminTabContent.innerHTML = html;

  } else if (currentAdminTab === 'staff') {
    // 2. Staff Activity
    const staffMap = new Map<string, { clientId: string; clips: number; projects: number; lastActive: string }>();

    // Current staff
    staffMap.set(currentStaffId || 'demo_staff', {
      clientId: currentClientId || 'demo_client',
      clips: videoSequence.length,
      projects: 1,
      lastActive: new Date().toISOString()
    });

    clips.forEach((c: any) => {
      const sid = c.staff_id || 'unknown';
      if (!staffMap.has(sid)) {
        staffMap.set(sid, { clientId: c.client_id || 'demo_client', clips: 0, projects: 0, lastActive: c.uploaded_at || new Date().toISOString() });
      }
      staffMap.get(sid)!.clips++;
    });

    projects.forEach((p: any) => {
      const sid = p.staff_id || 'unknown';
      if (!staffMap.has(sid)) {
        staffMap.set(sid, { clientId: p.client_id || 'demo_client', clips: 0, projects: 0, lastActive: p.created_at || new Date().toISOString() });
      }
      staffMap.get(sid)!.projects++;
    });

    let html = `
      <div class="space-y-4">
        <h3 class="text-sm font-semibold text-white">Staff Engagement & Pacing Status</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border border-zinc-800 rounded-xl overflow-hidden">
            <thead class="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
              <tr>
                <th class="p-3">Staff ID</th>
                <th class="p-3">Client</th>
                <th class="p-3">Clips</th>
                <th class="p-3">Projects</th>
                <th class="p-3">Last Active</th>
                <th class="p-3">Status Flag</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-800 bg-zinc-950/40">
    `;

    const now = Date.now();
    staffMap.forEach((info, sid) => {
      const lastTime = new Date(info.lastActive).getTime() || now;
      const daysAgo = Math.floor((now - lastTime) / (1000 * 60 * 60 * 24));
      let badge = '<span class="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-medium">Active</span>';
      if (daysAgo > 10) {
        badge = '<span class="bg-zinc-700/40 text-zinc-400 border border-zinc-600/30 px-2 py-0.5 rounded text-[10px] font-medium">Inactive</span>';
      } else if (daysAgo > 3) {
        badge = '<span class="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded text-[10px] font-medium">Needs follow-up</span>';
      }

      html += `
        <tr>
          <td class="p-3 font-mono font-medium text-white">${sid}</td>
          <td class="p-3 text-zinc-400">${info.clientId}</td>
          <td class="p-3 text-white font-semibold">${info.clips}</td>
          <td class="p-3 text-white font-semibold">${info.projects}</td>
          <td class="p-3 text-zinc-400">${daysAgo === 0 ? 'Today' : daysAgo + 'd ago'}</td>
          <td class="p-3">${badge}</td>
        </tr>
      `;
    });

    html += `</tbody></table></div></div>`;
    elements.adminTabContent.innerHTML = html;

  } else if (currentAdminTab === 'storage') {
    // 3. Storage Health (Staff at 4 or 5 active clips)
    const staffClipCounts = new Map<string, { clientId: string; activeClips: number }>();

    // Current staff active clips
    staffClipCounts.set(currentStaffId || 'demo_staff', { clientId: currentClientId || 'demo_client', activeClips: videoSequence.length });

    clips.forEach((c: any) => {
      if (c.status === 'active' || !c.status) {
        const sid = c.staff_id || 'demo_staff';
        if (!staffClipCounts.has(sid)) {
          staffClipCounts.set(sid, { clientId: c.client_id || 'demo_client', activeClips: 0 });
        }
        staffClipCounts.get(sid)!.activeClips++;
      }
    });

    const atOrNearCap = Array.from(staffClipCounts.entries()).filter(([_, v]) => v.activeClips >= 4);

    let html = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-sm font-semibold text-white">Storage Health & Clip Caps (Max 5 Clips)</h3>
            <p class="text-xs text-zinc-400">Monitoring staff workspaces reaching storage limits</p>
          </div>
          <span class="text-xs font-mono bg-amber-500/10 text-amber-400 px-2.5 py-1 rounded-full border border-amber-500/20">${atOrNearCap.length} at or near cap</span>
        </div>
        <div class="space-y-2">
    `;

    if (atOrNearCap.length === 0) {
      html += `<div class="p-6 text-center text-xs text-zinc-500 bg-zinc-950 border border-zinc-800 rounded-xl">No staff are currently at or near the 5-clip storage cap. All storage healthy.</div>`;
    } else {
      atOrNearCap.forEach(([sid, data]) => {
        const isCap = data.activeClips >= 5;
        html += `
          <div class="p-3.5 bg-zinc-950 border ${isCap ? 'border-red-500/40' : 'border-amber-500/40'} rounded-xl flex items-center justify-between">
            <div>
              <p class="text-xs font-bold text-white">${sid} <span class="font-normal text-zinc-400 text-[11px]">(${data.clientId})</span></p>
              <p class="text-[10px] text-zinc-400 mt-0.5">${data.activeClips} active clips stored</p>
            </div>
            <span class="text-xs font-bold px-2.5 py-1 rounded-full ${isCap ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}">
              ${isCap ? '5/5 Cap Reached' : '4/5 Approaching Cap'}
            </span>
          </div>
        `;
      });
    }

    html += `</div></div>`;
    elements.adminTabContent.innerHTML = html;

  } else if (currentAdminTab === 'recent_exports') {
    // 4. Recent Exports (Last 48 Hours)
    elements.adminTabContent.innerHTML = '<div class="text-xs text-zinc-400 p-8 text-center">Loading recent exports from Supabase...</div>';
    const recent = await fetchRecentExports();

    let html = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-sm font-semibold text-white">Recent Exports (Last 48 Hours)</h3>
            <p class="text-xs text-zinc-400">Marketing videos exported by staff ready for posting</p>
          </div>
          <span class="text-xs font-mono bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded-full border border-blue-500/20">${recent.length} exports</span>
        </div>
        <div class="space-y-2.5">
    `;

    if (recent.length === 0) {
      html += `<div class="p-8 text-center text-xs text-zinc-500 bg-zinc-950 border border-zinc-800 rounded-xl">No exports recorded in the last 48 hours. When staff finish exports, they appear here with instant play and copy link buttons.</div>`;
    } else {
      recent.forEach((p: any) => {
        const timeStr = p.exported_at ? new Date(p.exported_at).toLocaleString() : (p.created_at ? new Date(p.created_at).toLocaleString() : 'Recent');
        const durStr = formatTime(p.total_duration_seconds || 0);
        const url = p.exported_video_url || '';

        html += `
          <div class="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-white font-mono">${p.staff_id || 'staff'}</span>
                <span class="text-[11px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">${p.client_id || 'client'}</span>
                <span class="text-[11px] text-zinc-400 font-mono">${durStr}</span>
              </div>
              <p class="text-[11px] text-zinc-500">${timeStr}</p>
              ${url ? `<p class="text-[10px] font-mono text-zinc-500 truncate max-w-md">${url}</p>` : ''}
            </div>
            <div class="flex items-center gap-2 shrink-0">
              ${url ? `
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1 shadow-sm">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  <span>Open</span>
                </a>
                <button class="btn-copy-recent-export text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1 cursor-pointer" data-url="${url}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  <span>Copy link</span>
                </button>
              ` : `
                <span class="text-xs text-zinc-500">Local save only</span>
              `}
            </div>
          </div>
        `;
      });
    }

    html += `</div></div>`;
    elements.adminTabContent.innerHTML = html;

    // Attach copy button handlers
    elements.adminTabContent.querySelectorAll('.btn-copy-recent-export').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = btn.getAttribute('data-url');
        if (u) {
          try {
            await navigator.clipboard.writeText(u);
            const orig = btn.innerHTML;
            btn.innerHTML = '<span>Copied!</span>';
            setTimeout(() => { btn.innerHTML = orig; }, 2000);
          } catch {}
        }
      });
    });

  } else if (currentAdminTab === 'export_storage') {
    // 5. Export Storage & Retention
    elements.adminTabContent.innerHTML = '<div class="text-xs text-zinc-400 p-8 text-center">Scanning vidhub_exports storage bucket...</div>';
    const stats = await fetchExportStorageStats();
    const sizeMb = (stats.totalSizeBytes / (1024 * 1024)).toFixed(2);
    const oldFiles = stats.files.filter(f => f.isOld);
    const oldSizeMb = (oldFiles.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2);

    let html = `
      <div class="space-y-4">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-white">Export Storage (vidhub_exports)</h3>
            <p class="text-xs text-zinc-400">MP4 storage usage and 48h retention management</p>
          </div>
          <button id="btn-clear-old-exports" class="text-xs bg-red-600 hover:bg-red-500 text-white font-medium px-3.5 py-2 rounded-xl transition-colors flex items-center gap-1.5 shadow self-start md:self-auto cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            <span>Clear old exports (>48h)</span>
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="p-4 bg-zinc-950 border border-zinc-800 rounded-xl">
            <span class="text-zinc-500 block text-[10px]">Total Files in Bucket</span>
            <span class="text-lg font-bold text-white">${stats.fileCount}</span>
          </div>
          <div class="p-4 bg-zinc-950 border border-zinc-800 rounded-xl">
            <span class="text-zinc-500 block text-[10px]">Approx. Total Size</span>
            <span class="text-lg font-bold text-blue-400">${sizeMb} MB</span>
          </div>
          <div class="p-4 bg-zinc-950 border border-zinc-800 rounded-xl">
            <span class="text-zinc-500 block text-[10px]">Eligible to Delete (>48h)</span>
            <span class="text-lg font-bold ${oldFiles.length > 0 ? 'text-amber-400' : 'text-zinc-400'}">${oldFiles.length} files (${oldSizeMb} MB)</span>
          </div>
        </div>

        <div class="space-y-2">
          <h4 class="text-xs font-semibold text-zinc-400">Stored Video Files:</h4>
    `;

    if (stats.files.length === 0) {
      html += `<div class="p-6 text-center text-xs text-zinc-500 bg-zinc-950 border border-zinc-800 rounded-xl">No files currently in vidhub_exports bucket.</div>`;
    } else {
      stats.files.forEach(f => {
        const fMb = (f.size / (1024 * 1024)).toFixed(2);
        const timeStr = f.createdAt ? new Date(f.createdAt).toLocaleString() : 'Unknown';
        html += `
          <div class="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between text-xs">
            <div class="truncate mr-3">
              <span class="font-mono text-white text-[11px] block truncate">${f.path}</span>
              <span class="text-[10px] text-zinc-500">${timeStr}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="font-mono text-zinc-300 text-[11px]">${fMb} MB</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full ${f.isOld ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}">
                ${f.isOld ? '>48h Old' : 'Recent'}
              </span>
            </div>
          </div>
        `;
      });
    }

    html += `</div></div>`;
    elements.adminTabContent.innerHTML = html;

    // Attach clear old exports button
    const btnClear = elements.adminTabContent.querySelector('#btn-clear-old-exports') as HTMLButtonElement | null;
    btnClear?.addEventListener('click', async () => {
      if (!confirm('Delete all export files older than 48 hours for ALL clients?')) return;
      btnClear.disabled = true;
      btnClear.textContent = 'Clearing...';
      const res = await clearAllOldExports();
      alert(`Deleted ${res.deletedCount} files (${(res.freedBytes / (1024 * 1024)).toFixed(2)} MB freed).`);
      renderAdminDashboardTab();
    });

  } else if (currentAdminTab === 'beats') {
    // 6. Beat Library
    const beats = await fetchAllBeats();

    let html = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-sm font-semibold text-white">Curated Beat Library</h3>
            <p class="text-xs text-zinc-400">Approve or unapprove beats for staff use</p>
          </div>
          <button id="btn-admin-upload-beat" class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 shadow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            <span>Upload a Beat</span>
          </button>
        </div>
        <div class="space-y-2">
    `;

    if (beats.length === 0) {
      html += `<div class="p-6 text-center text-xs text-zinc-500 bg-zinc-950 border border-zinc-800 rounded-xl">No custom beats uploaded yet. The two built-in instrumental loops are serving as standard library fallbacks.</div>`;
    } else {
      beats.forEach(b => {
        html += `
          <div class="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between gap-3">
            <div class="truncate">
              <p class="text-xs font-semibold text-white truncate">${b.title}</p>
              <p class="text-[10px] text-zinc-400">By ${b.added_by || 'admin'} • ${(b.duration_seconds || 30).toFixed(0)}s</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button class="btn-toggle-approve text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${b.approved ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}" data-id="${b.id}" data-status="${b.approved}">
                ${b.approved ? 'Approved ✓' : 'Unapproved'}
              </button>
            </div>
          </div>
        `;
      });
    }

    html += `</div></div>`;
    elements.adminTabContent.innerHTML = html;

    // Attach Beat Upload
    const btnUpload = elements.adminTabContent.querySelector('#btn-admin-upload-beat');
    btnUpload?.addEventListener('click', () => {
      elements.beatUploadInput.click();
    });

    // Attach Toggle Approve
    const toggleBtns = elements.adminTabContent.querySelectorAll('.btn-toggle-approve');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const bid = btn.getAttribute('data-id');
        const st = btn.getAttribute('data-status') === 'true';
        if (bid) {
          await toggleBeatApproval(bid, st);
          renderAdminDashboardTab();
        }
      });
    });
  }
}

async function handleAdminBeatUpload(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;
  const file = target.files[0];
  const title = prompt("Enter Beat Title:", file.name.replace(/\.[^/.]+$/, ''));
  if (title) {
    await uploadBeatToLibrary(title, file);
    renderAdminDashboardTab();
  }
  target.value = '';
}

// --- TRANSITIONS MODAL ---
function setupTransitionControls() {
  elements.toolTransition.addEventListener('click', openTransitionModal);
  elements.btnCloseTransition.addEventListener('click', () => elements.modalTransition.classList.add('hidden'));
  elements.btnApplyTransition.addEventListener('click', () => {
    elements.modalTransition.classList.add('hidden');
    renderTimeline();
    updatePlayheadAndPreview();
  });

  elements.transitionDurationSlider.addEventListener('input', () => {
    const val = parseFloat(elements.transitionDurationSlider.value);
    globalTransition.duration = val;
    elements.transitionDurationDisplay.textContent = `${val.toFixed(1)}s`;
    renderTimeline();
    updatePlayheadAndPreview();
  });

  const presetBtns = document.querySelectorAll('.transition-preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-transition') as TransitionType;
      if (!type) return;
      globalTransition.type = type;
      updateTransitionModalUI();
      renderTimeline();
      updatePlayheadAndPreview();
    });
  });

  elements.btnPreviewTransition.addEventListener('click', previewTransition);
}

function openTransitionModal() {
  updateTransitionModalUI();
  elements.modalTransition.classList.remove('hidden');
}

function updateTransitionModalUI() {
  const presetBtns = document.querySelectorAll('.transition-preset-btn');
  presetBtns.forEach(btn => {
    const type = btn.getAttribute('data-transition');
    if (type === globalTransition.type) {
      btn.classList.remove('bg-zinc-800', 'text-zinc-300');
      btn.classList.add('bg-blue-600', 'text-white', 'shadow-md');
    } else {
      btn.classList.remove('bg-blue-600', 'text-white', 'shadow-md');
      btn.classList.add('bg-zinc-800', 'text-zinc-300');
    }
  });

  elements.transitionDurationSlider.value = globalTransition.duration.toString();
  elements.transitionDurationDisplay.textContent = `${globalTransition.duration.toFixed(1)}s`;

  const dot = document.getElementById('transition-active-dot');
  if (dot) {
    if (globalTransition.type === 'none') {
      dot.classList.add('hidden');
    } else {
      dot.classList.remove('hidden');
    }
  }
}

function previewTransition() {
  if (videoSequence.length < 2) {
    alert("Add at least 2 video clips to preview transitions.");
    return;
  }
  const firstClipDur = videoSequence[0].trimEnd - videoSequence[0].trimStart;
  currentGlobalTime = Math.max(0, firstClipDur - 0.8);
  elements.timelineScroll.scrollLeft = currentGlobalTime * PX_PER_SEC;
  if (!isPlaying) {
    togglePlay();
  }
}

// --- TEXT OVERLAY ---
let textStyle = 'Fade In';
function setupTextPresetButtons() {
  const btns = document.querySelectorAll('.preset-btn');
  btns.forEach(b => {
    b.addEventListener('click', (e) => {
      btns.forEach(btn => {
        btn.classList.remove('bg-white', 'text-black');
        btn.classList.add('bg-zinc-800', 'text-white');
      });
      const t = e.target as HTMLElement;
      t.classList.remove('bg-zinc-800', 'text-white');
      t.classList.add('bg-white', 'text-black');
      textStyle = t.textContent || 'Fade In';
    });
  });
}

function handleAddText() {
  const text = elements.textOverlayInput.value.trim();
  if (!text) return;

  const totalDur = getTotalDuration();
  const initDur = totalDur > 0 ? Math.min(3, Math.max(0.5, totalDur - currentGlobalTime)) : 3;

  const o: OverlayClip = {
    id: `txt_${Date.now()}`,
    type: 'text',
    content: text,
    style: textStyle,
    startTime: currentGlobalTime,
    duration: Math.max(0.5, initDur),
    x: 50,
    y: 50
  };
  overlays.push(o);

  elements.textOverlayInput.value = '';
  elements.modalText.classList.add('hidden');
  selectItem(o.id, 'overlay');
  renderTimeline();
}

// --- VOICEOVER ---
function setupVoiceover() {
  const btnAction = document.getElementById('btn-vo-record-action') as HTMLButtonElement;
  const statusTxt = document.getElementById('vo-status-text') as HTMLSpanElement;
  const playback = document.getElementById('vo-playback') as HTMLAudioElement;
  const btnSave = document.getElementById('btn-save-vo') as HTMLButtonElement;
  const modal = document.getElementById('modal-vo') as HTMLDivElement;

  const tabRecord = document.getElementById('vo-tab-record') as HTMLButtonElement;
  const tabAi = document.getElementById('vo-tab-ai') as HTMLButtonElement;
  const secRecord = document.getElementById('vo-section-record') as HTMLDivElement;
  const secAi = document.getElementById('vo-section-ai') as HTMLDivElement;

  const aiTextInput = document.getElementById('ai-voice-text') as HTMLTextAreaElement;
  const aiVoiceBtns = document.querySelectorAll('.ai-voice-btn');
  const btnGenAi = document.getElementById('btn-generate-ai-voice') as HTMLButtonElement;
  const loadingAi = document.getElementById('ai-voice-loading') as HTMLDivElement;

  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let blob: Blob | null = null;
  let currentAiVoice = 'female';

  tabRecord.addEventListener('click', () => {
    tabRecord.classList.replace('text-zinc-400', 'text-white');
    tabRecord.classList.add('bg-zinc-800');
    tabAi.classList.replace('text-white', 'text-zinc-400');
    tabAi.classList.remove('bg-zinc-800');
    secRecord.classList.replace('hidden', 'flex');
    secAi.classList.replace('flex', 'hidden');
    playback.classList.add('hidden');
    btnSave.classList.add('hidden');
    blob = null;
  });

  tabAi.addEventListener('click', () => {
    tabAi.classList.replace('text-zinc-400', 'text-white');
    tabAi.classList.add('bg-zinc-800');
    tabRecord.classList.replace('text-white', 'text-zinc-400');
    tabRecord.classList.remove('bg-zinc-800');
    secAi.classList.replace('hidden', 'flex');
    secRecord.classList.replace('flex', 'hidden');
    playback.classList.add('hidden');
    btnSave.classList.add('hidden');
    blob = null;
  });

  aiVoiceBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      aiVoiceBtns.forEach(b => {
        b.classList.remove('bg-white', 'text-black');
        b.classList.add('bg-zinc-800', 'text-white');
      });
      const t = e.target as HTMLElement;
      t.classList.remove('bg-zinc-800', 'text-white');
      t.classList.add('bg-white', 'text-black');
      currentAiVoice = t.dataset.voice || 'female';
    });
  });

  btnGenAi.addEventListener('click', async () => {
    const text = aiTextInput.value.trim();
    if (!text) return;
    loadingAi.classList.remove('hidden');
    btnGenAi.disabled = true;

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: currentAiVoice })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const binary = atob(data.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      blob = new Blob([bytes], { type: 'audio/mp3' });
      playback.src = URL.createObjectURL(blob);
      playback.classList.remove('hidden');
      btnSave.classList.remove('hidden');
    } catch (e: any) {
      alert("TTS Error: " + e.message);
    } finally {
      loadingAi.classList.add('hidden');
      btnGenAi.disabled = false;
    }
  });

  elements.toolVo.addEventListener('click', () => {
    modal.classList.remove('hidden');
    playback.classList.add('hidden');
    btnSave.classList.add('hidden');
    statusTxt.textContent = 'Tap to record';
    chunks = [];
    blob = null;
  });

  btnAction.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      btnAction.classList.remove('animate-pulse');
      statusTxt.textContent = 'Finished';
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        chunks = [];

        mediaRecorder.ondataavailable = e => chunks.push(e.data);
        mediaRecorder.onstop = () => {
          blob = new Blob(chunks, { type: 'audio/webm' });
          playback.src = URL.createObjectURL(blob);
          playback.classList.remove('hidden');
          btnSave.classList.remove('hidden');
        };

        mediaRecorder.start();
        btnAction.classList.add('animate-pulse');
        statusTxt.textContent = 'Recording...';
        playback.classList.add('hidden');
        btnSave.classList.add('hidden');
      } catch {
        alert("Mic access denied");
      }
    }
  });

  btnSave.addEventListener('click', async () => {
    if (!blob) return;
    const audioEl = document.createElement('audio');
    audioEl.src = URL.createObjectURL(blob);
    await new Promise(r => { audioEl.onloadedmetadata = r; });

    overlays.push({
      id: `vo_${Date.now()}`,
      type: 'voiceover',
      file: blob,
      startTime: currentGlobalTime,
      duration: audioEl.duration
    });

    modal.classList.add('hidden');
    aiTextInput.value = '';
    renderTimeline();
  });
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- EXPORT PIPELINE WITH SHAPE FRAMES & MUSIC MIXING ---
async function handleExport() {
  if (videoSequence.length === 0) return;

  // Disable the Export button while exporting. Never start a second export by itself.
  elements.btnExport.disabled = true;

  elements.modalExport.classList.remove('hidden');
  elements.exportProgressView.classList.remove('hidden');
  elements.exportCompleteView.classList.add('hidden');
  elements.exportProgressBar.style.width = '0%';
  elements.exportStatusText.textContent = "Loading FFmpeg...";

  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    elements.exportProgressBar.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    elements.exportStatusText.textContent = `Processing Video... ${Math.round(progress * 100)}%`;
  });

  try {
    await ffmpeg.load({
      coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
      wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
    });

    elements.exportStatusText.textContent = "Writing video sequence...";
    for (let i = 0; i < videoSequence.length; i++) {
      const clip = videoSequence[i];
      const filename = `input_${i}.mp4`;
      await ffmpeg.writeFile(filename, await fetchFile(clip.file));
    }

    let processedFiles: string[] = [];
    const hasFade = (globalTransition.type === 'fade' || globalTransition.type === 'crossfade') && videoSequence.length > 1;

    if (hasFade) {
      elements.exportStatusText.textContent = "Rendering transitions...";
      for (let i = 0; i < videoSequence.length; i++) {
        const clip = videoSequence[i];
        const rawName = `input_${i}.mp4`;
        const outName = `fade_${i}.mp4`;
        const dur = Math.max(0.6, clip.trimEnd - clip.trimStart);
        const fadeD = Math.min(globalTransition.duration / 2, Math.max(0.15, dur * 0.3));

        const vfFilters: string[] = [];
        const afFilters: string[] = [];

        if (clip.trimStart > 0 || clip.trimEnd < clip.duration) {
          vfFilters.push(`trim=start=${clip.trimStart}:end=${clip.trimEnd},setpts=PTS-STARTPTS`);
          afFilters.push(`atrim=start=${clip.trimStart}:end=${clip.trimEnd},asetpts=PTS-STARTPTS`);
        }

        if (i > 0) {
          vfFilters.push(`fade=t=in:st=0:d=${fadeD.toFixed(2)}`);
          afFilters.push(`afade=t=in:st=0:d=${fadeD.toFixed(2)}`);
        }
        if (i < videoSequence.length - 1) {
          const fadeOutStart = Math.max(0, dur - fadeD);
          vfFilters.push(`fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeD.toFixed(2)}`);
          afFilters.push(`afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeD.toFixed(2)}`);
        }

        const vf = vfFilters.length > 0 ? vfFilters.join(',') : 'null';
        const af = afFilters.length > 0 ? afFilters.join(',') : 'anull';

        try {
          await ffmpeg.exec([
            '-i', rawName,
            '-vf', vf,
            '-af', af,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'aac',
            outName
          ]);
          processedFiles.push(outName);
        } catch {
          processedFiles.push(rawName);
        }
      }
    } else {
      processedFiles = videoSequence.map((_, i) => `input_${i}.mp4`);
    }

    let concatList = '';
    for (const file of processedFiles) {
      concatList += `file ${file}\n`;
    }
    await ffmpeg.writeFile('concat.txt', concatList);

    elements.exportStatusText.textContent = "Concatenating sequence...";
    await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'concat.txt',
      '-c', 'copy',
      'raw_sequence.mp4'
    ]);

    let currentInputVideo = 'raw_sequence.mp4';

    // 1. Handle Video Overlays (PiP videos and Overlay Clip videos)
    const videoOverlays = overlays.filter(o => 
      (o.style === 'pip' || (o.type === 'overlay_clip' && o.isVideo) || (o.isVideo && o.file)) && o.file
    );

    if (videoOverlays.length > 0) {
      elements.exportStatusText.textContent = "Compositing video overlays...";
      for (let i = 0; i < videoOverlays.length; i++) {
        const ov = videoOverlays[i];
        if (!ov.file) continue;

        const ovVidFileName = `overlay_vid_${i}.mp4`;
        await ffmpeg.writeFile(ovVidFileName, await fetchFile(ov.file));

        const outWithVid = `vid_comp_${i}.mp4`;
        const startSec = ov.startTime;
        const endSec = ov.startTime + ov.duration;
        const dur = ov.duration;
        const targetW = Math.max(120, Math.round(1080 * ((ov.width || 35) / 100)));
        const targetH = Math.max(120, Math.round(1920 * ((ov.height || 35) / 100)));
        const xPos = Math.round((ov.x !== undefined ? ov.x : 30) * 10.8);
        const yPos = Math.round((ov.y !== undefined ? ov.y : 30) * 19.2);
        const isMuted = ov.isMuted !== false;

        try {
          if (!isMuted) {
            try {
              const delayMs = Math.round(startSec * 1000);
              await ffmpeg.exec([
                '-i', currentInputVideo,
                '-stream_loop', '-1',
                '-i', ovVidFileName,
                '-filter_complex',
                `[1:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setpts=PTS-STARTPTS+${startSec.toFixed(2)}/TB[ov];` +
                `[0:v][ov]overlay=${xPos}:${yPos}:enable='between(t,${startSec.toFixed(2)},${endSec.toFixed(2)})'[v];` +
                `[1:a]atrim=0:${dur.toFixed(2)},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},volume=1.0[delayed_ov_a];` +
                `[0:a][delayed_ov_a]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
                '-map', '[v]',
                '-map', '[aout]',
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-c:a', 'aac',
                outWithVid
              ]);
              currentInputVideo = outWithVid;
              continue;
            } catch (aErr) {
              console.warn('Overlay audio mix fallback to video only:', aErr);
            }
          }

          // Video-only overlay (muted or audio fallback)
          await ffmpeg.exec([
            '-i', currentInputVideo,
            '-stream_loop', '-1',
            '-i', ovVidFileName,
            '-filter_complex',
            `[1:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setpts=PTS-STARTPTS+${startSec.toFixed(2)}/TB[ov];` +
            `[0:v][ov]overlay=${xPos}:${yPos}:enable='between(t,${startSec.toFixed(2)},${endSec.toFixed(2)})'[v]`,
            '-map', '[v]',
            '-map', '0:a?',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'copy',
            outWithVid
          ]);
          currentInputVideo = outWithVid;
        } catch (vidErr) {
          console.warn('Video overlay compositing fallback:', vidErr);
        }
      }
    }

    // 2. Handle Picture Overlays (Image tool shape masks & Overlay Clip pictures)
    const pictureOverlays = overlays.filter(o => 
      ((o.type === 'image' && o.style !== 'pip') || (o.type === 'overlay_clip' && !o.isVideo)) && o.file
    );

    if (pictureOverlays.length > 0) {
      elements.exportStatusText.textContent = "Overlaying picture overlays...";
      for (let i = 0; i < pictureOverlays.length; i++) {
        const ov = pictureOverlays[i];
        if (!ov.file) continue;

        // Render masked shape onto transparent canvas
        const imgEl = new Image();
        imgEl.src = URL.createObjectURL(ov.file);
        await new Promise(res => { imgEl.onload = res; imgEl.onerror = res; });

        const targetW = Math.max(100, Math.round(1080 * ((ov.width || 40) / 100)));
        const targetH = Math.max(100, Math.round(1920 * ((ov.height || 40) / 100)));
        const maskedBlob = await renderMaskedImageBlob(imgEl, ov.shape || 'rectangle', targetW, targetH);
        const imgFileName = `overlay_pic_${i}.png`;
        await ffmpeg.writeFile(imgFileName, await fetchFile(maskedBlob));

        const outWithImg = `img_comp_${i}.mp4`;
        const startSec = ov.startTime;
        const endSec = ov.startTime + ov.duration;
        const xPos = Math.round((ov.x !== undefined ? ov.x : 30) * 10.8);
        const yPos = Math.round((ov.y !== undefined ? ov.y : 30) * 19.2);

        try {
          await ffmpeg.exec([
            '-i', currentInputVideo,
            '-i', imgFileName,
            '-filter_complex', `[0:v][1:v]overlay=${xPos}:${yPos}:enable='between(t,${startSec.toFixed(2)},${endSec.toFixed(2)})'[v]`,
            '-map', '[v]',
            '-map', '0:a?',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'copy',
            outWithImg
          ]);
          currentInputVideo = outWithImg;
        } catch (imgErr) {
          console.warn('Picture overlay filter fallback:', imgErr);
        }
      }
    }

    // Handle Text Overlays (renders text at updated start time & duration)
    const textOverlays = overlays.filter(o => o.type === 'text' && o.content);
    if (textOverlays.length > 0) {
      elements.exportStatusText.textContent = "Overlaying text...";
      for (let i = 0; i < textOverlays.length; i++) {
        const ov = textOverlays[i];
        if (!ov.content) continue;

        try {
          const textBlob = await renderTextOverlayBlob(ov.content, ov.style);
          const textFileName = `text_overlay_${i}.png`;
          await ffmpeg.writeFile(textFileName, await fetchFile(textBlob));

          const outWithText = `text_comp_${i}.mp4`;
          const startSec = ov.startTime;
          const endSec = ov.startTime + ov.duration;
          const yPos = Math.max(0, Math.round((ov.y !== undefined ? ov.y : 50) * 19.2 - 180));

          await ffmpeg.exec([
            '-i', currentInputVideo,
            '-i', textFileName,
            '-filter_complex', `[0:v][1:v]overlay=0:${yPos}:enable='between(t,${startSec.toFixed(2)},${endSec.toFixed(2)})'[v]`,
            '-map', '[v]',
            '-map', '0:a?',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'copy',
            outWithText
          ]);
          currentInputVideo = outWithText;
        } catch (textErr) {
          console.warn('Text overlay filter fallback:', textErr);
        }
      }
    }

    // Handle Voiceover Overlays (mixes voiceovers at their respective start times)
    const voOverlays = overlays.filter(o => o.type === 'voiceover' && o.file);
    if (voOverlays.length > 0) {
      elements.exportStatusText.textContent = "Mixing voiceovers...";
      for (let i = 0; i < voOverlays.length; i++) {
        const vo = voOverlays[i];
        if (!vo.file) continue;
        const voFileName = `vo_track_${i}.wav`;
        try {
          await ffmpeg.writeFile(voFileName, await fetchFile(vo.file));
          const delayMs = Math.round(vo.startTime * 1000);
          const outWithVo = `vo_comp_${i}.mp4`;
          await ffmpeg.exec([
            '-i', currentInputVideo,
            '-i', voFileName,
            '-filter_complex', `[1:a]adelay=${delayMs}|${delayMs},volume=1.0[delayed_vo];[0:a][delayed_vo]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
            '-map', '0:v',
            '-map', '[aout]',
            '-c:v', 'copy',
            '-c:a', 'aac',
            outWithVo
          ]);
          currentInputVideo = outWithVo;
        } catch (voErr) {
          console.warn('Voiceover mixing fallback:', voErr);
        }
      }
    }

    // Handle Music Mixing with looping and ducking
    const totalDur = getTotalDuration();
    let finalOutputFile = currentInputVideo;

    if (selectedMusic) {
      elements.exportStatusText.textContent = "Mixing background music...";
      try {
        const musicBlob = await fetch(selectedMusic.url).then(r => r.blob());
        await ffmpeg.writeFile('music_track.wav', await fetchFile(musicBlob));

        const hasVoiceovers = overlays.some(o => o.type === 'voiceover');
        const musicVol = hasVoiceovers ? '0.25' : '0.5';

        // Loop music to fill entire video duration and mix with original video audio
        await ffmpeg.exec([
          '-i', currentInputVideo,
          '-stream_loop', '-1',
          '-i', 'music_track.wav',
          '-t', `${totalDur.toFixed(2)}`,
          '-filter_complex', `[1:a]volume=${musicVol}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
          '-map', '0:v',
          '-map', '[aout]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          'final_with_music.mp4'
        ]);
        finalOutputFile = 'final_with_music.mp4';
      } catch (musicErr) {
        console.warn('Music mixing fallback:', musicErr);
      }
    }

    // Default export quality to 720p to optimize file size for Supabase storage (<50MB limit)
    elements.exportStatusText.textContent = "Encoding 720p output...";
    const out720p = 'export_720p.mp4';
    try {
      await ffmpeg.exec([
        '-i', finalOutputFile,
        '-vf', 'scale=720:-2:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '24',
        '-c:a', 'aac',
        '-b:a', '128k',
        out720p
      ]);
      finalOutputFile = out720p;
    } catch (scaleErr) {
      console.warn('720p scaling fallback, using current output:', scaleErr);
    }

    elements.exportStatusText.textContent = "Reading finished video...";
    const data = await ffmpeg.readFile(finalOutputFile);
    const blob = new Blob([data], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const exportFilename = `video-${dateStr}.mp4`;
    const videoFile = new File([blob], exportFilename, { type: 'video/mp4' });

    // Show Export complete screen (stays open until staff closes it)
    elements.exportProgressView.classList.add('hidden');
    elements.exportCompleteView.classList.remove('hidden');
    elements.exportPreviewVideo.src = blobUrl;
    elements.exportPreviewVideo.load();

    // Reset feedback notices
    elements.savePhoneNotice.classList.add('hidden');
    elements.shareNotice.classList.add('hidden');
    elements.exportUploadError.classList.add('hidden');
    elements.exportLinkBox.classList.add('hidden');
    elements.exportCloudStatus.classList.remove('hidden');
    elements.exportCloudStatus.innerHTML = `
      <svg class="animate-spin h-3.5 w-3.5 text-blue-400" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
      <span id="export-cloud-status-text">Saving a backup copy…</span>
    `;
    elements.btnCopyExportLink.disabled = true;
    elements.copyLinkBtnText.textContent = 'Link not ready';

    let uploadedCloudUrl: string | null = null;
    let uploadedFilePath: string | null = null;

    // 1. Button: Save to phone — BIGGEST button, strong colour. Direct download inside tap handler
    elements.btnSaveToPhone.onclick = () => {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = exportFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      elements.savePhoneNotice.classList.remove('hidden');
    };

    // 2. Button: Share (WhatsApp, Facebook…) — big colour button
    elements.btnShareExport.onclick = async () => {
      elements.shareNotice.classList.add('hidden');
      if (navigator.share) {
        try {
          if (navigator.canShare && navigator.canShare({ files: [videoFile] })) {
            await navigator.share({
              files: [videoFile],
              title: exportFilename,
              text: 'Marketing Video'
            });
            return;
          } else if (uploadedCloudUrl) {
            await navigator.share({
              url: uploadedCloudUrl,
              title: exportFilename,
              text: 'Marketing Video'
            });
            return;
          } else {
            elements.shareNotice.textContent = "Sharing is not supported here. Use Save to phone.";
            elements.shareNotice.classList.remove('hidden');
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            if (uploadedCloudUrl) {
              try {
                await navigator.share({ url: uploadedCloudUrl });
                return;
              } catch {}
            }
            elements.shareNotice.textContent = "Sharing is not supported here. Use Save to phone.";
            elements.shareNotice.classList.remove('hidden');
          }
        }
      } else {
        elements.shareNotice.textContent = "Sharing is not supported here. Use Save to phone.";
        elements.shareNotice.classList.remove('hidden');
      }
    };

    // 3. Button: Copy link — smaller button
    elements.btnCopyExportLink.onclick = async () => {
      if (!uploadedCloudUrl) return;
      try {
        await navigator.clipboard.writeText(uploadedCloudUrl);
        elements.copyLinkBtnText.textContent = 'Link copied';
        setTimeout(() => {
          if (uploadedCloudUrl) elements.copyLinkBtnText.textContent = 'Copy link';
        }, 2500);
      } catch {
        elements.exportLinkBox.classList.remove('hidden');
        elements.copyLinkBtnText.textContent = 'Select link below';
      }
    };

    // 4. Button: Back to editing — smaller button; closes screen, keeps project
    elements.btnBackToEditing.onclick = () => {
      elements.modalExport.classList.add('hidden');
      elements.btnExport.disabled = false;
    };

    // Background upload finished MP4 to Supabase storage bucket 'vidhub_exports'
    const isOver50MB = blob.size > 50 * 1024 * 1024;
    if (isOver50MB) {
      elements.exportCloudStatus.classList.add('hidden');
      elements.exportUploadError.classList.remove('hidden');
      elements.exportUploadErrorMsg.textContent = `File size (${(blob.size / (1024 * 1024)).toFixed(1)}MB) exceeds the Supabase free plan 50MB limit.`;
      elements.copyLinkBtnText.textContent = 'Link not ready';
      elements.btnCopyExportLink.disabled = true;

      await recordProjectExport({
        client_id: currentClientId,
        staff_id: currentStaffId,
        clip_sequence: videoSequence.map(c => ({ id: c.id, trimStart: c.trimStart, trimEnd: c.trimEnd })),
        text_overlays: overlays.filter(o => o.type === 'text'),
        image_overlays: overlays.filter(o => o.type === 'image' || o.type === 'overlay_clip'),
        music_track_id: selectedMusic?.id || null,
        total_duration_seconds: totalDur,
        exported_video_url: null,
        exported_file_path: null,
        exported_at: new Date().toISOString()
      });
    } else {
      try {
        const uploadRes = await uploadExportToSupabase(currentClientId, currentStaffId, blob);
        uploadedCloudUrl = uploadRes.publicUrl;
        uploadedFilePath = uploadRes.filePath;

        elements.exportCloudStatus.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-emerald-400"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span class="text-emerald-400 font-medium">Backup copy saved to cloud</span>
        `;
        elements.exportLinkBox.classList.remove('hidden');
        elements.exportLinkText.textContent = uploadedCloudUrl;
        elements.btnCopyExportLink.disabled = false;
        elements.copyLinkBtnText.textContent = 'Copy link';

        await recordProjectExport({
          client_id: currentClientId,
          staff_id: currentStaffId,
          clip_sequence: videoSequence.map(c => ({ id: c.id, trimStart: c.trimStart, trimEnd: c.trimEnd })),
          text_overlays: overlays.filter(o => o.type === 'text'),
          image_overlays: overlays.filter(o => o.type === 'image' || o.type === 'overlay_clip'),
          music_track_id: selectedMusic?.id || null,
          total_duration_seconds: totalDur,
          exported_video_url: uploadedCloudUrl,
          exported_file_path: uploadedFilePath,
          exported_at: new Date().toISOString()
        });
      } catch (err: any) {
        console.warn('Supabase export upload failed:', err);
        const errMsg = err?.message || String(err);
        elements.exportCloudStatus.classList.add('hidden');
        elements.exportUploadError.classList.remove('hidden');
        elements.exportUploadErrorMsg.textContent = `Upload error: ${errMsg}`;
        elements.copyLinkBtnText.textContent = 'Link not ready';
        elements.btnCopyExportLink.disabled = true;

        await recordProjectExport({
          client_id: currentClientId,
          staff_id: currentStaffId,
          clip_sequence: videoSequence.map(c => ({ id: c.id, trimStart: c.trimStart, trimEnd: c.trimEnd })),
          text_overlays: overlays.filter(o => o.type === 'text'),
          image_overlays: overlays.filter(o => o.type === 'image' || o.type === 'overlay_clip'),
          music_track_id: selectedMusic?.id || null,
          total_duration_seconds: totalDur,
          exported_video_url: null,
          exported_file_path: null,
          exported_at: new Date().toISOString()
        });
      }
    }
  } catch (e: any) {
    console.error(e);
    elements.exportStatusText.textContent = `Export Failed: ${e?.message || e}. Please try again.`;
    elements.btnExport.disabled = false;
    const existingClose = elements.exportProgressView.querySelector('.btn-close-export-error');
    if (!existingClose) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn-close-export-error mt-4 px-4 py-2 bg-zinc-800 text-white rounded-xl text-xs font-medium hover:bg-zinc-700 cursor-pointer';
      closeBtn.textContent = 'Close';
      closeBtn.onclick = () => {
        elements.modalExport.classList.add('hidden');
        elements.btnExport.disabled = false;
        closeBtn.remove();
      };
      elements.exportProgressView.appendChild(closeBtn);
    }
  }
}

// Start
document.addEventListener('DOMContentLoaded', init);
