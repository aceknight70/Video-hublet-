-- Vidhub Supabase Schema
-- Run this in your Supabase SQL Editor

-- vidhub_beats: admin-managed music library
CREATE TABLE IF NOT EXISTS vidhub_beats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    file_url TEXT NOT NULL,
    duration_seconds NUMERIC,
    added_by TEXT NOT NULL,
    approved BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- vidhub_clips: staff-uploaded source clips
CREATE TABLE IF NOT EXISTS vidhub_clips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    file_url TEXT NOT NULL,
    duration_seconds NUMERIC,
    status TEXT DEFAULT 'active', -- active, exported, expired
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- vidhub_projects: staff in-progress/completed combined videos
CREATE TABLE IF NOT EXISTS vidhub_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    clip_sequence JSONB NOT NULL DEFAULT '[]', -- ordered list of clip ids + trim points
    text_overlays JSONB NOT NULL DEFAULT '[]',
    image_overlays JSONB NOT NULL DEFAULT '[]',
    music_track_id UUID REFERENCES vidhub_beats(id),
    voiceover_url TEXT,
    total_duration_seconds NUMERIC,
    exported_video_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    exported_at TIMESTAMP WITH TIME ZONE
);

-- Storage Buckets
-- Note: Create these buckets manually in the Supabase UI if SQL doesn't have privileges:
-- 1. vidhub_clips (private, for raw uploads)
-- 2. vidhub_beats (public read, admin write)
-- 3. vidhub_exports (private, temporary holding)

-- Row Level Security (RLS)
ALTER TABLE vidhub_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE vidhub_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE vidhub_beats ENABLE ROW LEVEL SECURITY;

-- Policies for vidhub_clips
CREATE POLICY "Staff can read own clips" ON vidhub_clips
    FOR SELECT USING (staff_id = current_setting('request.jwt.claims', true)::json->>'staff_id' AND client_id = current_setting('request.jwt.claims', true)::json->>'client_id');
CREATE POLICY "Staff can insert own clips" ON vidhub_clips
    FOR INSERT WITH CHECK (staff_id = current_setting('request.jwt.claims', true)::json->>'staff_id' AND client_id = current_setting('request.jwt.claims', true)::json->>'client_id');
CREATE POLICY "Staff can delete own clips" ON vidhub_clips
    FOR DELETE USING (staff_id = current_setting('request.jwt.claims', true)::json->>'staff_id' AND client_id = current_setting('request.jwt.claims', true)::json->>'client_id');

-- Policies for vidhub_projects
CREATE POLICY "Staff can manage own projects" ON vidhub_projects
    FOR ALL USING (staff_id = current_setting('request.jwt.claims', true)::json->>'staff_id' AND client_id = current_setting('request.jwt.claims', true)::json->>'client_id');

-- Policies for vidhub_beats
CREATE POLICY "All staff can read beats" ON vidhub_beats
    FOR SELECT USING (true);
-- Note: Replace 'admin' with your actual admin role check if different
CREATE POLICY "Only admins can manage beats" ON vidhub_beats
    FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'admin');
