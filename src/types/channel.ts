export interface ChannelRow {
  id: string
  name: string
  handle: string
  description: string | null
  avatar_url: string | null
  cover_url: string | null
  category: string
  is_public: boolean
  is_verified: boolean
  subscriber_count: number
  owner_id: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export interface ChannelSubscriberRow {
  channel_id: string
  user_id: string
  notifications: boolean
  subscribed_at: string
}

export interface ChannelPostRow {
  id: string
  channel_id: string
  sender_id: string | null
  content: string | null
  type: string
  media_url: string | null
  media_type: string | null
  thumbnail_url: string | null
  media_items: any
  view_count: number
  is_pinned: boolean
  created_at: string
  sender_display_name: string | null
  sender_avatar_url: string | null
}

export interface ChannelCommentRow {
  id: string
  post_id: string
  sender_id: string
  content: string
  reply_to_id: string | null
  created_at: string
  sender_display_name: string
  sender_avatar_url: string | null
  sender_username: string
}
