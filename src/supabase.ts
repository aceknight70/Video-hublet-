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
  exported_file_path?: string | null;
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
    const { data, error } = await supabase.from('vidhub_projects').insert({
      client_id: project.client_id,
      staff_id: project.staff_id,
      clip_sequence: project.clip_sequence,
      text_overlays: project.text_overlays,
      image_overlays: project.image_overlays,
      music_track_id: project.music_track_id,
      voiceover_url: project.voiceover_url,
      total_duration_seconds: project.total_duration_seconds,
      exported_video_url: project.exported_video_url || null,
      exported_file_path: project.exported_file_path || null,
      exported_at: project.exported_at || new Date().toISOString()
    }).select().maybeSingle();

    if (error) {
      console.warn('recordProjectExport warning:', error.message);
    }
    return data;
  } catch (err) {
    console.warn('recordProjectExport error:', err);
    return null;
  }
}

/**
 * Upload finished export MP4 to vidhub_exports bucket and return public URL & path
 */
export async function uploadExportToSupabase(
  clientId: string,
  staffId: string,
  file: Blob | File
): Promise<{ publicUrl: string; filePath: string }> {
  const timestamp = Date.now();
  const filePath = `${clientId}/${staffId}/${timestamp}.mp4`;

  const { data, error } = await supabase.storage
    .from('vidhub_exports')
    .upload(filePath, file, { contentType: 'video/mp4', upsert: true });

  if (error) {
    throw error;
  }

  const { data: urlData } = supabase.storage
    .from('vidhub_exports')
    .getPublicUrl(filePath);

  return {
    publicUrl: urlData?.publicUrl || '',
    filePath
  };
}

/**
 * Clean up exports older than 48 hours for a specific staff member
 */
export async function cleanupOldStaffExports(clientId: string, staffId: string) {
  try {
    const folder = `${clientId}/${staffId}`;
    const { data: files, error } = await supabase.storage
      .from('vidhub_exports')
      .list(folder, { limit: 100 });

    if (error || !files) return;

    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    const toDelete: string[] = [];

    for (const f of files) {
      if (!f.name) continue;
      const t = new Date(f.created_at || f.updated_at).getTime();
      if (t && t < twoDaysAgo) {
        toDelete.push(`${folder}/${f.name}`);
      }
    }

    if (toDelete.length > 0) {
      await supabase.storage.from('vidhub_exports').remove(toDelete);
    }
  } catch (err) {
    console.warn('cleanupOldStaffExports error:', err);
  }
}

/**
 * Clean up raw clips in vidhub_clips older than 48 hours for a staff member
 */
export async function cleanupOldStaffClips(clientId: string, staffId: string) {
  try {
    const folder = `${clientId}/${staffId}`;
    const { data: files, error } = await supabase.storage
      .from('vidhub_clips')
      .list(folder, { limit: 100 });

    if (error || !files) return;

    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    const toDelete: string[] = [];

    for (const f of files) {
      if (!f.name) continue;
      const t = new Date(f.created_at || f.updated_at).getTime();
      if (t && t < twoDaysAgo) {
        toDelete.push(`${folder}/${f.name}`);
      }
    }

    if (toDelete.length > 0) {
      await supabase.storage.from('vidhub_clips').remove(toDelete);
    }
  } catch (err) {
    console.warn('cleanupOldStaffClips error:', err);
  }
}

/**
 * Fetch exports from the last 2 days (48 hours), newest first
 */
export async function fetchRecentExports() {
  try {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('vidhub_projects')
      .select('*')
      .gte('exported_at', twoDaysAgo)
      .not('exported_video_url', 'is', null)
      .order('exported_at', { ascending: false });

    if (error) {
      console.warn('fetchRecentExports warning:', error.message);
      // Fallback query
      const { data: fallback } = await supabase
        .from('vidhub_projects')
        .select('*')
        .not('exported_video_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(30);
      return fallback || [];
    }
    return data || [];
  } catch (err) {
    console.warn('fetchRecentExports exception:', err);
    return [];
  }
}

/**
 * Get export storage statistics across all clients in vidhub_exports
 */
export async function fetchExportStorageStats(): Promise<{
  fileCount: number;
  totalSizeBytes: number;
  files: { path: string; name: string; size: number; createdAt: string; isOld: boolean }[];
}> {
  const result = {
    fileCount: 0,
    totalSizeBytes: 0,
    files: [] as { path: string; name: string; size: number; createdAt: string; isOld: boolean }[]
  };

  try {
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    const { data: clientFolders } = await supabase.storage.from('vidhub_exports').list('');
    if (!clientFolders) return result;

    for (const c of clientFolders) {
      if (!c.name) continue;
      const { data: staffFolders } = await supabase.storage.from('vidhub_exports').list(c.name);
      if (!staffFolders) continue;

      for (const s of staffFolders) {
        if (!s.name) continue;
        const folder = `${c.name}/${s.name}`;
        const { data: files } = await supabase.storage.from('vidhub_exports').list(folder);
        if (!files) continue;

        for (const f of files) {
          if (!f.id || !f.name) continue;
          const size = f.metadata?.size || 0;
          const t = new Date(f.created_at || f.updated_at).getTime() || 0;
          const isOld = t > 0 && t < twoDaysAgo;

          result.fileCount++;
          result.totalSizeBytes += size;
          result.files.push({
            path: `${folder}/${f.name}`,
            name: f.name,
            size,
            createdAt: f.created_at || f.updated_at || '',
            isOld
          });
        }
      }
    }
  } catch (err) {
    console.warn('fetchExportStorageStats error:', err);
  }

  return result;
}

/**
 * Clear all exports older than 48 hours across ALL clients
 */
export async function clearAllOldExports(): Promise<{ deletedCount: number; freedBytes: number }> {
  try {
    const stats = await fetchExportStorageStats();
    const oldFiles = stats.files.filter(f => f.isOld);

    if (oldFiles.length === 0) {
      return { deletedCount: 0, freedBytes: 0 };
    }

    const pathsToDelete = oldFiles.map(f => f.path);
    let freedBytes = 0;
    oldFiles.forEach(f => { freedBytes += f.size; });

    for (let i = 0; i < pathsToDelete.length; i += 100) {
      const batch = pathsToDelete.slice(i, i + 100);
      await supabase.storage.from('vidhub_exports').remove(batch);
    }

    return { deletedCount: oldFiles.length, freedBytes };
  } catch (err) {
    console.warn('clearAllOldExports error:', err);
    return { deletedCount: 0, freedBytes: 0 };
  }
}

