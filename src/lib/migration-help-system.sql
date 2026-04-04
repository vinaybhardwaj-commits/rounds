-- ============================================
-- Help System Tables
-- Created: April 2026
-- ============================================

-- Track every help question + response for personalization and analytics
CREATE TABLE IF NOT EXISTS help_interactions (
  id SERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  matched_features TEXT[] DEFAULT '{}',
  response_source VARCHAR(20) NOT NULL DEFAULT 'template', -- 'ai', 'template', 'no-match'
  context_page VARCHAR(255),
  helpful BOOLEAN, -- null = no feedback, true = thumbs up, false = thumbs down
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for per-user history queries
CREATE INDEX IF NOT EXISTS idx_help_interactions_profile ON help_interactions(profile_id, created_at DESC);

-- Index for analytics (top questions, coverage gaps)
CREATE INDEX IF NOT EXISTS idx_help_interactions_features ON help_interactions USING GIN(matched_features);

-- Track dismissed nudges and what's-new badges
CREATE TABLE IF NOT EXISTS help_dismissals (
  id SERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feature_id VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'whats-new', -- 'whats-new', 'nudge', 'onboarding'
  dismissed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, feature_id, type)
);

CREATE INDEX IF NOT EXISTS idx_help_dismissals_profile ON help_dismissals(profile_id);
