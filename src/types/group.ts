export interface GroupRow {
  id: string
  name: string
  description: string | null
  avatar_url: string | null
  invite_link: string
  max_members: number
  member_count: number
  is_private: boolean
  owner_id: string | null
  disappearing_messages_ttl: number | null
  slow_mode_ttl: number | null
  created_at: string
  updated_at: string
}

export interface GroupMemberRow {
  group_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  joined_at: string
  muted_until: string | null
  display_name: string
  username: string
  avatar_url: string | null
  is_online: boolean
  last_seen: string | null
}

export interface GroupMessageRow {
  id: string
  group_id: string
  sender_id: string | null
  content: string | null
  type: string
  media_url: string | null
  media_type: string | null
  media_size: number | null
  thumbnail_url: string | null
  reply_to_id: string | null
  is_edited: boolean
  edited_at: string | null
  is_system: boolean
  system_event: string | null
  created_at: string
  sender_display_name: string | null
  sender_avatar_url: string | null
  sender_username: string | null
}
