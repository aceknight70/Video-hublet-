import { createClient } from '@supabase/supabase-js';

// Supabase credentials per project specification
export const SUPABASE_URL = 'https://habfyuqbvrfdswsxjnfv.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhYmZ5dXFidnJmZHN3c3hqbmZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNDY1MzUsImV4cCI6MjA5ODgyMjUzNX0.XFndez152v8ksdYGh-CV34e3JlPxH4CzkqdXHWlOYe4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface VidhubClipRow {
  id: string;
  client_id: string;
  staff_id: string;
  file_url: string;
  duration_seconds: number;
  status: string;
  uploaded_at?: string;
}

export interface VidhubBeatRow {
  id: string;
  title: string;
  file_url: string;
  duration_seconds: number;
  added_by: string;
  approved: boolean;
  created_at?: string;
}

export interface VidhubProjectRow {
  id?: string;
  client_id: string;
  staff_id: string;
  clip_sequence: any[];
  text_overlays: any[];
  image_overlays: any[];
  music_track_id?: string | null;
  voiceover_url?: string | null;
  total_duration_seconds: number;
  exported_video_url?: string | null;
  created_at?: string;
  exported_at?: string;
}

/**
 * Upload a source clip file to Supabase storage bucket 'vidhub_clips' and insert row into 'vidhub_clips'
 */
export async function uploadClipToSupabase(
  clientId: string,
  staffId: string,
  clipId: string,
  file: File | Blob,
  duration: number
): Promise<{ fileUrl?: string; rowId?: string }> {
  try {
    const ext = file.type.includes('quicktime') ? 'mov' : 'mp4';
    const filePath = `${clientId}/${staffId}/${clipId}.${ext}`;

    // Upload to storage bucket
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('vidhub_clips')
      .upload(filePath, file, { upsert: true });

    let publicUrl = '';
    if (!uploadErr && uploadData) {
      const { data: urlData } = supabase.storage.from('vidhub_clips').getPublicUrl(filePath);
      publicUrl = urlData?.publicUrl || '';
    }

    // Insert row into vidhub_clips
    const { data: rowData, error: insertErr } = await supabase
      .from('vidhub_clips')
      .insert({
        id: clipId,
        client_id: clientId,
        staff_id: staffId,
        file_url: publicUrl,
        duration_seconds: duration,
        status: 'active'
      })
      .select()
      .maybeSingle();

    if (insertErr) {
      console.warn('Supabase vidhub_clips insert info:', insertErr.message);
    }

    return { fileUrl: publicUrl, rowId: rowData?.id || clipId };
  } catch (err) {
    console.warn('Supabase uploadClip error (app will continue offline):', err);
    return {};
  }
}

/**
 * Delete clip from Supabase storage and table
 */
export async function deleteClipFromSupabase(clientId: string, staffId: string, clipId: string, fileUrl?: string) {
  try {
    // 1. Delete from table
    const { error: dbErr } = await supabase
      .from('vidhub_clips')
      .delete()
      .eq('id', clipId);
    if (dbErr) console.warn('Supabase delete row warning:', dbErr.message);

    // 2. Delete file from storage if fileUrl is given or try default path
    const extMatch = fileUrl ? (fileUrl.endsWith('.mov') ? 'mov' : 'mp4') : 'mp4';
    const filePath = `${clientId}/${staffId}/${clipId}.${extMatch}`;
    await supabase.storage.from('vidhub_clips').remove([filePath]);
  } catch (err) {
    console.warn('Supabase deleteClip warning:', err);
  }
}

/**
 * Fetch approved beats from vidhub_beats table
 */
export async function fetchApprovedBeats(): Promise<VidhubBeatRow[]> {
  try {
    const { data, error } = await supabase
      .from('vidhub_beats')
      .select('*')
      .eq('approved', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Supabase fetchApprovedBeats warning:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Supabase fetchApprovedBeats error:', err);
    return [];
  }
}

/**
 * Fetch all beats (for Admin Master Section)
 */
export async function fetchAllBeats(): Promise<VidhubBeatRow[]> {
  try {
    const { data, error } = await supabase
      .from('vidhub_beats')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Supabase fetchAllBeats warning:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Supabase fetchAllBeats error:', err);
    return [];
  }
}

/**
 * Toggle beat approval status in vidhub_beats
 */
export async function toggleBeatApproval(beatId: string, currentStatus: boolean): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('vidhub_beats')
      .update({ approved: !currentStatus })
      .eq('id', beatId);

    if (error) {
      console.warn('Supabase toggleBeatApproval error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Supabase toggleBeatApproval exception:', err);
    return false;
  }
}

/**
 * Upload beat audio file to vidhub_beats storage and insert row with approved = true
 */
export async function uploadBeatToLibrary(title: string, file: File): Promise<VidhubBeatRow | null> {
  try {
    const fileId = `beat_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const ext = file.name.split('.').pop() || 'mp3';
    const filePath = `library/${fileId}.${ext}`;

    // Upload to vidhub_beats bucket
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('vidhub_beats')
      .upload(filePath, file, { upsert: true });

    let fileUrl = '';
    if (!uploadErr && uploadData) {
      const { data: urlData } = supabase.storage.from('vidhub_beats').getPublicUrl(filePath);
      fileUrl = urlData?.publicUrl || '';
    } else {
      fileUrl = URL.createObjectURL(file);
    }

    // Estimate or get duration
    const tempAudio = new Audio(fileUrl);
    let dur = 30;
    try {
      await new Promise((res, rej) => {
        tempAudio.onloadedmetadata = () => res(true);
        tempAudio.onerror = () => res(true);
        setTimeout(() => res(true), 2000);
      });
      dur = Math.round(tempAudio.duration || 30);
    } catch {}

    const { data, error } = await supabase
      .from('vidhub_beats')
      .insert({
        title: title || file.name.replace(/\.[^/.]+$/, ''),
        file_url: fileUrl,
        duration_seconds: dur,
        added_by: 'admin',
        approved: true
      })
      .select()
      .maybeSingle();

    if (error) {
      console.warn('Supabase uploadBeat insert warning:', error.message);
      // Return synthetic row so UI works immediately
      return {
        id: fileId,
        title: title || file.name,
        file_url: fileUrl,
        duration_seconds: dur,
        added_by: 'admin',
        approved: true,
        created_at: new Date().toISOString()
      };
    }
    return data;
  } catch (err) {
    console.error('Upload beat error:', err);
    return null;
  }
}

/**
 * Fetch master analytics for Master Section
 */
export async function fetchMasterAnalytics() {
  try {
    const [clipsRes, projectsRes] = await Promise.all([
      supabase.from('vidhub_clips').select('*'),
      supabase.from('vidhub_projects').select('*')
    ]);

    const clips = clipsRes.data || [];
    const projects = projectsRes.data || [];

    return { clips, projects };
  } catch (err) {
    console.warn('fetchMasterAnalytics error:', err);
    return { clips: [], projects: [] };
  }
}

/**
 * Record an export to vidhub_projects
 */
export async function recordProjectExport(project: VidhubProjectRow) {
  try {
    await supabase.from('vidhub_projects').insert({
      client_id: project.client_id,
      staff_id: project.staff_id,
      clip_sequence: project.clip_sequence,
      text_overlays: project.text_overlays,
      image_overlays: project.image_overlays,
      music_track_id: project.music_track_id,
      voiceover_url: project.voiceover_url,
      total_duration_seconds: project.total_duration_seconds,
      exported_video_url: project.exported_video_url,
      exported_at: new Date().toISOString()
    });
  } catch (err) {
    console.warn('recordProjectExport error:', err);
  }
}
