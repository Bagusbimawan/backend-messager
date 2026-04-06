export interface CommunityRow {
  id: string
  name: string
  description: string | null
  cover_url: string | null
  category: string
  invite_link: string
  is_public: boolean
  is_verified: boolean
  member_count: number
  owner_id: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export interface CommunityTopicRow {
  id: string
  community_id: string
  name: string
  description: string | null
  icon: string | null
  is_announcements_only: boolean
  is_default: boolean
  position: number
  created_at: string
}

export interface CommunityMemberRow {
  community_id: string
  user_id: string
  role: 'owner' | 'admin' | 'moderator' | 'member'
  joined_at: string
  is_banned: boolean
  display_name: string
  username: string
  avatar_url: string | null
  is_online: boolean
  last_seen: string | null
}

export interface CommunityMessageRow {
  id: string
  topic_id: string
  sender_id: string | null
  content: string | null
  type: string
  media_url: string | null
  media_type: string | null
  thumbnail_url: string | null
  reply_to_id: string | null
  is_pinned: boolean
  is_edited: boolean
  edited_at: string | null
  created_at: string
  sender_display_name: string | null
  sender_avatar_url: string | null
  sender_username: string | null
}
