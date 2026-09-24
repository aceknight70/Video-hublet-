import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import Sortable from 'sortablejs';
import './index.css';

// --- CONFIG & STATE ---
const CONFIG = (window as any).HUBLET_CONFIG;
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

interface VideoClip {
  id: string;
  file: File | Blob;
  url: string;
  duration: number; // raw duration
  trimStart: number; // local trim in point (seconds)
  trimEnd: number; // local trim out point (seconds)
  name: string;
  transition?: TransitionConfig;
}

interface OverlayClip {
  id: string;
  type: 'text' | 'image' | 'audio' | 'voiceover';
  content?: string; // Text content or file url
  file?: Blob;
  style?: string; // e.g. "Fade In"
  startTime: number; // global start time on timeline
  duration: number;
}

let videoSequence: VideoClip[] = [];
let overlays: OverlayClip[] = [];

let currentGlobalTime = 0; // Playhead position in seconds
let isPlaying = false;
let animationFrameId = 0;

let selectedItemId: string | null = null;
let selectedItemType: 'video' | 'overlay' | null = null;

let currentClientId = sessionStorage.getItem('vidhub_client_id') || '';
let currentStaffId = sessionStorage.getItem('vidhub_staff_id') || '';

// --- DOM ELEMENTS ---
const elements = {
  loginOverlay: document.getElementById('login-overlay') as HTMLDivElement,
  btnLogin: document.getElementById('btn-login') as HTMLButtonElement,
  inputClientId: document.getElementById('input-client-id') as HTMLInputElement,
  inputStaffId: document.getElementById('input-staff-id') as HTMLInputElement,
  usageIndicator: document.getElementById('usage-indicator') as HTMLSpanElement,
  btnExport: document.getElementById('btn-export') as HTMLButtonElement,
  
  previewPlayerA: document.getElementById('preview-player-a') as HTMLVideoElement,
  previewPlayerB: document.getElementById('preview-player-b') as HTMLVideoElement,
  transitionOverlay: document.getElementById('transition-overlay') as HTMLDivElement,
  previewTransitionIndicator: document.getElementById('preview-transition-indicator') as HTMLDivElement,
  previewTransitionName: document.getElementById('preview-transition-name') as HTMLSpanElement,

  overlayContainer: document.getElementById('overlay-container') as HTMLDivElement,
  btnPlayPause: document.getElementById('btn-play-pause') as HTMLButtonElement,
  iconPlay: document.getElementById('icon-play') as unknown as SVGElement,
  iconPause: document.getElementById('icon-pause') as unknown as SVGElement,
  currentTimeDisplay: document.getElementById('current-time-display') as HTMLSpanElement,
  totalTimeDisplay: document.getElementById('total-time-display') as HTMLSpanElement,
  durationWarning: document.getElementById('duration-warning') as HTMLSpanElement,
  
  timelineScroll: document.getElementById('timeline-scroll') as HTMLDivElement,
  timelineContent: document.getElementById('timeline-content') as HTMLDivElement,
  playhead: document.getElementById('playhead') as HTMLDivElement,
  rulerContent: document.getElementById('ruler-content') as HTMLDivElement,
  trackVideo: document.getElementById('video-sequence-container') as HTMLDivElement,
  trackText: document.getElementById('track-text') as HTMLDivElement,
  trackAudio: document.getElementById('track-audio') as HTMLDivElement,
  
  toolUpload: document.getElementById('tool-upload') as HTMLButtonElement,
  toolText: document.getElementById('tool-text') as HTMLButtonElement,
  toolTransition: document.getElementById('tool-transition') as HTMLButtonElement,
  toolVo: document.getElementById('tool-vo') as HTMLButtonElement,
  toolTrim: document.getElementById('tool-trim') as HTMLButtonElement,
  toolDelete: document.getElementById('tool-delete') as HTMLButtonElement,
  uploadInput: document.getElementById('upload-input') as HTMLInputElement,
  btnInlineAdd: document.getElementById('btn-inline-add') as HTMLButtonElement,
  
  modalText: document.getElementById('modal-text') as HTMLDivElement,
  btnSaveText: document.getElementById('btn-save-text') as HTMLButtonElement,
  textOverlayInput: document.getElementById('text-overlay-input') as HTMLInputElement,

  modalTransition: document.getElementById('modal-transition') as HTMLDivElement,
  btnCloseTransition: document.getElementById('btn-close-transition') as HTMLButtonElement,
  btnApplyTransition: document.getElementById('btn-apply-transition') as HTMLButtonElement,
  btnPreviewTransition: document.getElementById('btn-preview-transition') as HTMLButtonElement,
  transitionDurationSlider: document.getElementById('transition-duration-slider') as HTMLInputElement,
  transitionDurationDisplay: document.getElementById('transition-duration-display') as HTMLSpanElement,
  
  toolTeleprompter: document.getElementById('tool-teleprompter') as HTMLButtonElement,
  teleprompterOverlay: document.getElementById('teleprompter-overlay') as HTMLDivElement,
  btnTpClose: document.getElementById('btn-tp-close') as HTMLButtonElement,
  btnTpPlay: document.getElementById('btn-tp-play') as HTMLButtonElement,
  btnTpPosition: document.getElementById('btn-tp-position') as HTMLButtonElement,
  tpTextInput: document.getElementById('teleprompter-text') as HTMLTextAreaElement,
  tpDisplay: document.getElementById('teleprompter-display') as HTMLDivElement,
  
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
  
  elements.btnPlayPause.addEventListener('click', togglePlay);
  elements.toolDelete.addEventListener('click', handleDeleteSelected);
  elements.btnExport.addEventListener('click', handleExport);
  
  // Teleprompter
  elements.toolTeleprompter.addEventListener('click', () => {
    elements.teleprompterOverlay.classList.remove('hidden');
  });
  setupTeleprompter();
  
  // Text Overlay events
  elements.toolText.addEventListener('click', () => {
    elements.modalText.classList.remove('hidden');
    elements.textOverlayInput.focus();
  });
  elements.btnSaveText.addEventListener('click', handleAddText);
  setupTextPresetButtons();
  
  // Voiceover events
  setupVoiceover();

  // Transition Controls
  setupTransitionControls();
  
  // Drag Sort for Video Track
  new Sortable(elements.trackVideo, {
    draggable: '.video-clip-item',
    animation: 150,
    ghostClass: 'opacity-50',
    onEnd: () => {
      // Reorder videoSequence array based on DOM
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
  
  // Player Events
  elements.previewPlayerA.addEventListener('ended', () => {});
  elements.previewPlayerB.addEventListener('ended', () => {});
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
  const cid = elements.inputClientId.value.trim();
  const sid = elements.inputStaffId.value.trim();
  if (cid && sid) {
    currentClientId = cid;
    currentStaffId = sid;
    sessionStorage.setItem('vidhub_client_id', cid);
    sessionStorage.setItem('vidhub_staff_id', sid);
    checkAuth();
  } else {
    alert("Please enter both Client ID and Staff ID.");
  }
}

// --- DATA & UPLOAD ---
async function handleUpload(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;
  
  const files = Array.from(target.files);
  if (videoSequence.length + files.length > CONFIG.maxClips) {
    alert(`Cap reached: Max ${CONFIG.maxClips} active clips allowed per workspace.`);
    return;
  }
  
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const duration = await getVideoDuration(url);
    const clip: VideoClip = {
      id: `vid_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
      file,
      url,
      duration,
      trimStart: 0,
      trimEnd: duration,
      name: file.name
    };
    videoSequence.push(clip);
  }
  
  target.value = '';
  renderTimeline();
}

function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.src = url;
    v.onloadedmetadata = () => resolve(v.duration);
  });
}

// --- TIMELINE RENDERING ---
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
  elements.timelineContent.style.width = `${totalPx + 150}px`; // Add padding buffer
  
  // Render Ruler
  let rulerHtml = '';
  for(let i=0; i<=Math.ceil(totalDur) + 5; i++) {
    rulerHtml += `<div class="absolute border-l border-zinc-700 h-2" style="left: ${i * PX_PER_SEC}px;">
      <span class="absolute top-2 -left-2">${i % 5 === 0 ? i+'s' : ''}</span>
    </div>`;
  }
  elements.rulerContent.innerHTML = rulerHtml;
  
  // Render Video Track
  elements.trackVideo.innerHTML = '';
  let currentOffset = 0;
  
  videoSequence.forEach((clip, index) => {
    const width = (clip.trimEnd - clip.trimStart) * PX_PER_SEC;
    const isSelected = selectedItemId === clip.id;
    
    const div = document.createElement('div');
    div.dataset.id = clip.id;
    div.className = `video-clip-item h-full bg-zinc-800 relative cursor-pointer border ${isSelected ? 'border-white z-10 scale-[1.02]' : 'border-black'} flex-shrink-0 group overflow-hidden select-none`;
    div.style.width = `${width}px`;
    
    // Attempt filmstrip by repeating video thumbnail
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
    currentOffset += width;

    // Render transition badge between clips
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
  elements.trackAudio.innerHTML = '';
  
  overlays.forEach(overlay => {
    const width = overlay.duration * PX_PER_SEC;
    const left = overlay.startTime * PX_PER_SEC;
    const isSelected = selectedItemId === overlay.id;
    
    const div = document.createElement('div');
    div.className = `absolute h-full rounded text-[10px] px-1 font-medium flex items-center overflow-hidden cursor-pointer ${isSelected ? 'border border-white shadow-lg z-10' : 'border border-transparent'}`;
    div.style.width = `${width}px`;
    div.style.left = `${left}px`;
    
    const contentSpan = document.createElement('span');
    contentSpan.className = 'truncate select-none pointer-events-none w-full';
    
    if (overlay.type === 'text') {
      div.classList.add('bg-blue-600/80', 'text-white');
      contentSpan.textContent = overlay.content || 'Text';
      div.appendChild(contentSpan);
      elements.trackText.appendChild(div);
    } else if (overlay.type === 'voiceover') {
      div.classList.add('bg-red-600/80', 'text-white');
      contentSpan.textContent = 'Voiceover';
      div.appendChild(contentSpan);
      elements.trackAudio.appendChild(div);
    }
    
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      selectItem(overlay.id, 'overlay');
    });
    
    // Resize handles for text
    if (isSelected && overlay.type === 'text') {
      const rightHandle = document.createElement('div');
      rightHandle.className = 'absolute right-0 top-0 bottom-0 w-6 bg-black/20 cursor-ew-resize hover:bg-black/40 flex items-center justify-center touch-none z-20';
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
          rightHandle.releasePointerCapture(ev.pointerId);
          rightHandle.removeEventListener('pointermove', onPointerMove);
          rightHandle.removeEventListener('pointerup', onPointerUp);
          rightHandle.removeEventListener('pointercancel', onPointerUp);
          renderTimeline(); // Re-render everything on drop
        };
        
        rightHandle.addEventListener('pointermove', onPointerMove);
        rightHandle.addEventListener('pointerup', onPointerUp);
        rightHandle.addEventListener('pointercancel', onPointerUp);
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
    elements.toolTrim.disabled = type !== 'video'; // Only video trimming supported in this demo
  } else {
    elements.toolDelete.disabled = true;
    elements.toolTrim.disabled = true;
  }
  
  renderTimeline(); // Re-render to show selection border
}

// Clear selection on background click
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('#timeline-scroll') && !target.closest('#track-video > div') && !target.closest('#track-text > div') && !target.closest('#track-audio > div')) {
    selectItem(null, null);
  }
});

function handleDeleteSelected() {
  if (!selectedItemId) return;
  if (selectedItemType === 'video') {
    videoSequence = videoSequence.filter(c => c.id !== selectedItemId);
  } else {
    overlays = overlays.filter(o => o.id !== selectedItemId);
  }
  selectItem(null, null);
  renderTimeline();
}

// --- PLAYBACK & PLAYHEAD ---
function handleTimelineScroll() {
  if (!isPlaying) {
    // Scrub based on scroll position
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
    
    // Explicitly start active video player when playing
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
  
  const delta = (timestamp - lastTimestamp) / 1000; // seconds
  lastTimestamp = timestamp;
  
  currentGlobalTime += delta;
  const total = getTotalDuration();
  
  if (currentGlobalTime >= total) {
    currentGlobalTime = total;
    togglePlay(); // pause
  }
  
  // Sync scroll position
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

  // Check if currentGlobalTime falls in a transition window between clip i and clip i+1
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
    // === IN TRANSITION ZONE ===
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
      if (playerA.paused && p < 0.95) {
        playerA.play().catch(() => {});
      }
      if (playerB.paused && (p > 0.1 || globalTransition.type === 'crossfade' || globalTransition.type === 'slide')) {
        playerB.play().catch(() => {});
      }
    }

    // Show indicator badge
    elements.previewTransitionIndicator.style.opacity = '1';
    elements.previewTransitionName.textContent = getTransitionDisplayName(globalTransition.type);

    // Apply animation effect
    if (globalTransition.type === 'fade') {
      // Cinematic dip to black
      elements.transitionOverlay.style.backgroundColor = '#000000';
      if (p < 0.5) {
        const subP = p / 0.5; // 0 to 1
        playerA.style.opacity = '1';
        playerA.style.transform = 'none';
        playerB.style.opacity = '0';
        playerB.style.transform = 'none';
        elements.transitionOverlay.style.opacity = `${subP}`;
        playerA.volume = Math.max(0, 1 - subP);
        playerB.volume = 0;
      } else {
        const subP = (p - 0.5) / 0.5; // 0 to 1
        playerA.style.opacity = '0';
        playerA.style.transform = 'none';
        playerB.style.opacity = '1';
        playerB.style.transform = 'none';
        elements.transitionOverlay.style.opacity = `${1 - subP}`;
        playerA.volume = 0;
        playerB.volume = Math.min(1, subP);
      }
    } else if (globalTransition.type === 'crossfade') {
      elements.transitionOverlay.style.opacity = '0';
      playerA.style.opacity = `${1 - p}`;
      playerA.style.transform = 'none';
      playerB.style.opacity = `${p}`;
      playerB.style.transform = 'none';
      playerA.volume = Math.max(0, 1 - p);
      playerB.volume = Math.min(1, p);
    } else if (globalTransition.type === 'white') {
      elements.transitionOverlay.style.backgroundColor = '#ffffff';
      if (p < 0.5) {
        const subP = p / 0.5;
        playerA.style.opacity = '1';
        playerA.style.transform = 'none';
        playerB.style.opacity = '0';
        playerB.style.transform = 'none';
        elements.transitionOverlay.style.opacity = `${subP}`;
      } else {
        const subP = (p - 0.5) / 0.5;
        playerA.style.opacity = '0';
        playerA.style.transform = 'none';
        playerB.style.opacity = '1';
        playerB.style.transform = 'none';
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
    // === REGULAR CLIP PLAYBACK (NOT IN TRANSITION) ===
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

    // Inactive player reset & PRELOAD NEXT CLIP
    inactivePlayer.style.opacity = '0';
    inactivePlayer.style.transform = 'none';
    inactivePlayer.volume = 0;
    if (!inactivePlayer.paused) {
      inactivePlayer.pause();
    }

    if (activeIdx + 1 < clipRanges.length) {
      const nextClip = clipRanges[activeIdx + 1].clip;
      if (inactivePlayer.dataset.clipId !== nextClip.id) {
        inactivePlayer.dataset.clipId = nextClip.id;
        inactivePlayer.src = nextClip.url;
        inactivePlayer.currentTime = nextClip.trimStart;
      }
    }
  }

  // 2. Render active Overlays
  renderActiveOverlays();
}

// --- TRANSITION CONTROLS ---
function setupTransitionControls() {
  elements.toolTransition.addEventListener('click', () => {
    openTransitionModal();
  });

  elements.btnCloseTransition.addEventListener('click', () => {
    elements.modalTransition.classList.add('hidden');
  });

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

  elements.btnPreviewTransition.addEventListener('click', () => {
    previewTransition();
  });
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

const activeAudioNodes = new Map<string, HTMLAudioElement>();

function renderActiveOverlays() {
  elements.overlayContainer.innerHTML = '';
  
  const currentlyActiveAudioIds = new Set<string>();
  
  overlays.forEach(overlay => {
    // Check if active
    if (currentGlobalTime >= overlay.startTime && currentGlobalTime < overlay.startTime + overlay.duration) {
      if (overlay.type === 'text') {
        const div = document.createElement('div');
        div.className = 'text-white font-bold text-3xl text-center drop-shadow-md';
        div.textContent = overlay.content || '';
        
        // Simple preset implementation
        if (overlay.style === 'Fade In') {
          const progress = currentGlobalTime - overlay.startTime;
          div.style.opacity = Math.min(progress / 0.5, 1).toString(); // fade over 0.5s
        } else if (overlay.style === 'Slide') {
           // Basic CSS animation simulation
           div.style.transform = `translateY(${Math.max(0, 50 - (currentGlobalTime - overlay.startTime)*100)}px)`;
        }
        
        elements.overlayContainer.appendChild(div);
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
          } else {
            if (Math.abs(audioEl.currentTime - localTime) > 0.2) {
              audioEl.currentTime = localTime;
            }
          }
        } else {
          if (!audioEl.paused) audioEl.pause();
          audioEl.currentTime = localTime;
        }
      }
    }
  });
  
  // Cleanup audio nodes that are no longer active
  for (const [id, audioEl] of activeAudioNodes.entries()) {
    if (!currentlyActiveAudioIds.has(id)) {
      audioEl.pause();
      audioEl.removeAttribute('src'); // Stop playback completely
      activeAudioNodes.delete(id);
    }
  }
}


// --- ADD TEXT OVERLAY ---
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
    duration: 3 // default 3 seconds
  };
  overlays.push(o);
  
  elements.textOverlayInput.value = '';
  elements.modalText.classList.add('hidden');
  renderTimeline();
}

// --- VOICEOVER & AI VOICE ---
function setupVoiceover() {
  const btnAction = document.getElementById('btn-vo-record-action') as HTMLButtonElement;
  const statusTxt = document.getElementById('vo-status-text') as HTMLSpanElement;
  const playback = document.getElementById('vo-playback') as HTMLAudioElement;
  const btnSave = document.getElementById('btn-save-vo') as HTMLButtonElement;
  const modal = document.getElementById('modal-vo') as HTMLDivElement;
  
  // Tabs
  const tabRecord = document.getElementById('vo-tab-record') as HTMLButtonElement;
  const tabAi = document.getElementById('vo-tab-ai') as HTMLButtonElement;
  const secRecord = document.getElementById('vo-section-record') as HTMLDivElement;
  const secAi = document.getElementById('vo-section-ai') as HTMLDivElement;
  
  // AI
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
      
      blob = new Blob([bytes], { type: 'audio/mp3' }); // default gen is wav/mp3
      const url = URL.createObjectURL(blob);
      playback.src = url;
      playback.classList.remove('hidden');
      btnSave.classList.remove('hidden');
    } catch(e: any) {
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
          const url = URL.createObjectURL(blob);
          playback.src = url;
          playback.classList.remove('hidden');
          btnSave.classList.remove('hidden');
        };
        
        mediaRecorder.start();
        btnAction.classList.add('animate-pulse');
        statusTxt.textContent = 'Recording...';
        playback.classList.add('hidden');
        btnSave.classList.add('hidden');
      } catch (err) {
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

// --- UTILS ---
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- EXPORT (FFMPEG) ---
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
    
    // 1. Write video files
    elements.exportStatusText.textContent = "Preparing files...";
    for (let i = 0; i < videoSequence.length; i++) {
      const clip = videoSequence[i];
      const filename = `input_${i}.mp4`;
      await ffmpeg.writeFile(filename, await fetchFile(clip.file));
    }

    let processedFiles: string[] = [];
    const hasFade = (globalTransition.type === 'fade' || globalTransition.type === 'crossfade') && videoSequence.length > 1;

    if (hasFade) {
      elements.exportStatusText.textContent = "Rendering fade transitions...";
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

        // Fade in from black if not first clip
        if (i > 0) {
          vfFilters.push(`fade=t=in:st=0:d=${fadeD.toFixed(2)}`);
          afFilters.push(`afade=t=in:st=0:d=${fadeD.toFixed(2)}`);
        }

        // Fade out to black if not last clip
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
        } catch (err) {
          console.warn(`Fade re-encode fallback for clip ${i}:`, err);
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
    
    // 2. Perform concatenation
    await ffmpeg.exec([
      '-f', 'concat', 
      '-safe', '0', 
      '-i', 'concat.txt',
      '-c', 'copy',
      'output.mp4'
    ]);
    
    elements.exportStatusText.textContent = "Generating final file...";
    
    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    
    // Trigger download (saves to gallery/local storage)
    const a = document.createElement('a');
    a.href = url;
    a.download = `VidHub_Export_${Date.now()}.mp4`;
    a.click();
    
    elements.modalExport.classList.add('hidden');
    
  } catch(e) {
    console.error(e);
    elements.exportStatusText.textContent = "Export Failed. Check console.";
    setTimeout(() => elements.modalExport.classList.add('hidden'), 3000);
  }
}

// --- TELEPROMPTER ---
function setupTeleprompter() {
  let tpScrollInterval = 0;
  let isTpScrolling = false;
  
  // Dragging logic
  let isDragging = false;
  let offsetX = 0, offsetY = 0;
  
  elements.teleprompterOverlay.addEventListener('mousedown', (e) => {
    // Only drag if clicking the top area or not typing in the textarea
    if (e.target !== elements.tpTextInput && e.target !== elements.tpDisplay && (e.target as HTMLElement).tagName !== 'BUTTON') {
      isDragging = true;
      const rect = elements.teleprompterOverlay.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    elements.teleprompterOverlay.style.left = `${e.clientX - offsetX}px`;
    elements.teleprompterOverlay.style.top = `${e.clientY - offsetY}px`;
    elements.teleprompterOverlay.style.right = 'auto'; // allow horizontal move
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
  
  elements.btnTpClose.addEventListener('click', () => {
    elements.teleprompterOverlay.classList.add('hidden');
    clearInterval(tpScrollInterval);
    isTpScrolling = false;
    elements.btnTpPlay.textContent = "Start Scroll";
  });
  
  elements.btnTpPosition.addEventListener('click', () => {
    if (elements.teleprompterOverlay.classList.contains('right-4')) {
      // It is currently spanning top, move to side
      elements.teleprompterOverlay.classList.remove('left-4', 'right-4');
      elements.teleprompterOverlay.classList.add('right-4', 'w-64', 'bottom-64', 'top-16');
      elements.teleprompterOverlay.style.left = 'auto';
      elements.teleprompterOverlay.style.top = '64px';
      elements.btnTpPosition.textContent = "Move to Top";
    } else {
      // Move to top
      elements.teleprompterOverlay.classList.remove('w-64', 'bottom-64', 'right-4');
      elements.teleprompterOverlay.classList.add('left-4', 'right-4');
      elements.teleprompterOverlay.style.left = '16px';
      elements.teleprompterOverlay.style.top = '64px';
      elements.btnTpPosition.textContent = "Move to Side";
    }
  });
  
  elements.btnTpPlay.addEventListener('click', () => {
    if (isTpScrolling) {
      clearInterval(tpScrollInterval);
      isTpScrolling = false;
      elements.btnTpPlay.textContent = "Start Scroll";
      elements.tpTextInput.classList.remove('hidden');
      elements.tpDisplay.classList.add('hidden');
    } else {
      const txt = elements.tpTextInput.value.trim();
      if (!txt) return;
      
      elements.tpDisplay.textContent = txt;
      elements.tpTextInput.classList.add('hidden');
      elements.tpDisplay.classList.remove('hidden');
      elements.tpDisplay.scrollTop = 0;
      
      isTpScrolling = true;
      elements.btnTpPlay.textContent = "Stop";
      
      tpScrollInterval = window.setInterval(() => {
        elements.tpDisplay.scrollTop += 1; // Scroll 1px every 50ms
      }, 50);
    }
  });
}

// Start
document.addEventListener('DOMContentLoaded', init);
