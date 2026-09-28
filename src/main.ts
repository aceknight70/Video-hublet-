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
  VidhubBeatRow
} from './supabase';
import { getBuiltinTracks, BuiltinTrack } from './audio_synthesizer';
import {
  ImageShape,
  getNextShape,
  getShapeIcon,
  renderMaskedImageBlob,
  getShapeCssClipPath
} from './shape_masks';

// --- CONFIG & CONSTANTS ---
export const MASTER_PIN = '2026';
const CONFIG = (window as any).HUBLET_CONFIG || { maxClips: 5, targetResolution: { w: 1080, h: 1920 }, fps: 30 };
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
  type: 'text' | 'image' | 'audio' | 'voiceover';
  content?: string; // Text content or image file url
  file?: Blob;
  style?: string; // e.g. "Fade In", "Slide"
  startTime: number; // global start time on timeline
  duration: number;
  shape?: ImageShape; // for image overlays
  x?: number; // percentage (0 - 100) on preview stage
  y?: number; // percentage (0 - 100) on preview stage
  width?: number; // percentage on preview stage
  height?: number; // percentage on preview stage
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

  const imgOverlay: OverlayClip = {
    id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type: 'image',
    file,
    content: url,
    shape: 'rectangle', // default
    startTime: currentGlobalTime,
    duration: 4,
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

  const pipOverlay: OverlayClip = {
    id: `pip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type: 'image', // reuse overlay engine with video tag or specialized overlay
    file,
    content: url,
    style: 'pip',
    shape: 'rectangle',
    startTime: currentGlobalTime,
    duration: Math.min(dur, 10),
    x: 60,
    y: 10,
    width: 35,
    height: 35
  };

  overlays.push(pipOverlay);
  target.value = '';
  selectItem(pipOverlay.id, 'overlay');
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
    div.className = `absolute h-full rounded text-[10px] px-1 font-medium flex items-center overflow-hidden cursor-pointer ${isSelected ? 'border border-white shadow-lg z-20' : 'border border-transparent'}`;
    div.style.width = `${width}px`;
    div.style.left = `${left}px`;

    const contentSpan = document.createElement('span');
    contentSpan.className = 'truncate select-none pointer-events-none w-full';

    if (overlay.type === 'text') {
      div.classList.add('bg-blue-600/80', 'text-white');
      contentSpan.textContent = overlay.content || 'Text';
      div.appendChild(contentSpan);
      elements.trackText.appendChild(div);
    } else if (overlay.type === 'image') {
      div.classList.add(overlay.style === 'pip' ? 'bg-purple-600/80' : 'bg-amber-600/80', 'text-white');
      contentSpan.textContent = overlay.style === 'pip' ? 'PiP Video' : `Image [${getShapeIcon(overlay.shape || 'rectangle')}]`;
      div.appendChild(contentSpan);
      if (elements.trackImage) {
        elements.trackImage.appendChild(div);
      } else {
        elements.trackText.appendChild(div);
      }
    } else if (overlay.type === 'voiceover') {
      div.classList.add('bg-red-600/80', 'text-white', 'z-10');
      contentSpan.textContent = 'Voiceover';
      div.appendChild(contentSpan);
      elements.trackAudio.appendChild(div);
    }

    div.addEventListener('click', (e) => {
      e.stopPropagation();
      selectItem(overlay.id, 'overlay');
    });

    // Resize handles for overlays on timeline
    if (isSelected) {
      const rightHandle = document.createElement('div');
      rightHandle.className = 'absolute right-0 top-0 bottom-0 w-6 bg-black/30 cursor-ew-resize hover:bg-black/50 flex items-center justify-center touch-none z-20';
      rightHandle.innerHTML = '<div class="w-1 h-3 bg-white rounded-full pointer-events-none shadow-sm"></div>';

      let isResizing = false;
      let startX = 0;
      let startWidth = 0;

      rightHandle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        rightHandle.setPointerCapture(e.pointerId);
        isResizing = true;
        startX = e.clientX;
        startWidth = overlay.duration * PX_PER_SEC;

        const onPointerMove = (ev: PointerEvent) => {
          if (!isResizing) return;
          const deltaX = ev.clientX - startX;
          const newWidth = Math.max(20, startWidth + deltaX);
          overlay.duration = newWidth / PX_PER_SEC;
          div.style.width = `${newWidth}px`;
        };

        const onPointerUp = (ev: PointerEvent) => {
          isResizing = false;
          try { rightHandle.releasePointerCapture(ev.pointerId); } catch {}
          rightHandle.removeEventListener('pointermove', onPointerMove);
          rightHandle.removeEventListener('pointerup', onPointerUp);
          renderTimeline();
          updatePlayheadAndPreview();
        };

        rightHandle.addEventListener('pointermove', onPointerMove);
        rightHandle.addEventListener('pointerup', onPointerUp);
      });

      div.appendChild(rightHandle);
    }
  });

  updatePlayheadAndPreview();
}

function selectItem(id: string | null, type: 'video' | 'overlay' | null) {
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
  elements.overlayContainer.innerHTML = '';
  const currentlyActiveAudioIds = new Set<string>();

  overlays.forEach(overlay => {
    const isActive = currentGlobalTime >= overlay.startTime && currentGlobalTime < overlay.startTime + overlay.duration;
    if (!isActive) return;

    if (overlay.type === 'text') {
      const wrapper = document.createElement('div');
      wrapper.className = 'absolute pointer-events-auto cursor-move select-none p-2 border border-dashed border-transparent hover:border-white/50 transition-colors';
      wrapper.style.left = `${overlay.x !== undefined ? overlay.x : 50}%`;
      wrapper.style.top = `${overlay.y !== undefined ? overlay.y : 50}%`;
      wrapper.style.transform = 'translate(-50%, -50%)';

      const div = document.createElement('div');
      div.className = 'text-white font-bold text-2xl text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]';
      div.textContent = overlay.content || '';

      if (overlay.style === 'Fade In') {
        const prog = currentGlobalTime - overlay.startTime;
        div.style.opacity = Math.min(prog / 0.5, 1).toString();
      } else if (overlay.style === 'Slide') {
        const prog = Math.max(0, 40 - (currentGlobalTime - overlay.startTime) * 80);
        div.style.transform = `translateY(${prog}px)`;
      }

      // Dragging text on video stage
      setupStageDrag(wrapper, overlay);

      wrapper.appendChild(div);
      elements.overlayContainer.appendChild(wrapper);

    } else if (overlay.type === 'image') {
      const wrapper = document.createElement('div');
      wrapper.className = 'absolute pointer-events-auto cursor-move select-none group border border-dashed border-white/40 hover:border-white transition-all shadow-md';
      const wPct = overlay.width || 40;
      const hPct = overlay.height || 40;
      wrapper.style.width = `${wPct}%`;
      wrapper.style.height = `${hPct}%`;
      wrapper.style.left = `${overlay.x !== undefined ? overlay.x : 30}%`;
      wrapper.style.top = `${overlay.y !== undefined ? overlay.y : 30}%`;

      if (overlay.style === 'pip') {
        // PiP Video Player on stage
        const pipVideo = document.createElement('video');
        pipVideo.src = overlay.content || '';
        pipVideo.autoplay = isPlaying;
        pipVideo.muted = true;
        pipVideo.loop = true;
        pipVideo.playsInline = true;
        pipVideo.className = 'w-full h-full object-cover rounded-lg shadow-xl';
        wrapper.appendChild(pipVideo);
      } else {
        // Image element with Shape Frame
        const img = document.createElement('img');
        img.src = overlay.content || '';
        img.className = 'w-full h-full object-cover';
        img.style.clipPath = getShapeCssClipPath(overlay.shape || 'rectangle');
        wrapper.appendChild(img);

        // Corner shape toggle button: Rectangle -> Circle -> Heart -> Rectangle
        const shapeBtn = document.createElement('button');
        shapeBtn.className = 'absolute -top-3 -left-3 w-6 h-6 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center text-xs shadow-lg border border-white/20 transition-transform active:scale-90 z-30 cursor-pointer';
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

      // Corner resize handle
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'absolute -bottom-2 -right-2 w-5 h-5 bg-white text-black rounded-full cursor-nwse-resize flex items-center justify-center shadow z-30';
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

  } else if (currentAdminTab === 'beats') {
    // 4. Beat Library
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

  const o: OverlayClip = {
    id: `txt_${Date.now()}`,
    type: 'text',
    content: text,
    style: textStyle,
    startTime: currentGlobalTime,
    duration: 3,
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

  elements.modalExport.classList.remove('hidden');
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

    // Handle Masked Images (Circle, Heart) overlays
    const imageOverlays = overlays.filter(o => o.type === 'image' && o.file);
    let currentInputVideo = 'raw_sequence.mp4';

    if (imageOverlays.length > 0) {
      elements.exportStatusText.textContent = "Overlaying shape framed images...";
      for (let i = 0; i < imageOverlays.length; i++) {
        const ov = imageOverlays[i];
        if (!ov.file) continue;

        // Render masked shape onto transparent canvas
        const imgEl = new Image();
        imgEl.src = URL.createObjectURL(ov.file);
        await new Promise(res => { imgEl.onload = res; imgEl.onerror = res; });

        const maskedBlob = await renderMaskedImageBlob(imgEl, ov.shape || 'rectangle', 360, 360);
        const imgFileName = `overlay_${i}.png`;
        await ffmpeg.writeFile(imgFileName, await fetchFile(maskedBlob));

        const outWithImg = `img_comp_${i}.mp4`;
        const startSec = ov.startTime;
        const endSec = ov.startTime + ov.duration;
        const xPos = Math.round((ov.x || 30) * 10.8);
        const yPos = Math.round((ov.y || 30) * 19.2);

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
          console.warn('Image overlay filter fallback:', imgErr);
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

    elements.exportStatusText.textContent = "Finalizing video download...";
    const data = await ffmpeg.readFile(finalOutputFile);
    const blob = new Blob([data], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `VidHub_${currentClientId}_${Date.now()}.mp4`;
    a.click();

    // Record export to Supabase
    recordProjectExport({
      client_id: currentClientId,
      staff_id: currentStaffId,
      clip_sequence: videoSequence.map(c => ({ id: c.id, trimStart: c.trimStart, trimEnd: c.trimEnd })),
      text_overlays: overlays.filter(o => o.type === 'text'),
      image_overlays: overlays.filter(o => o.type === 'image'),
      music_track_id: selectedMusic?.id || null,
      total_duration_seconds: totalDur
    });

    elements.modalExport.classList.add('hidden');
  } catch (e: any) {
    console.error(e);
    elements.exportStatusText.textContent = "Export Failed. Falling back...";
    setTimeout(() => elements.modalExport.classList.add('hidden'), 3000);
  }
}

// Start
document.addEventListener('DOMContentLoaded', init);
