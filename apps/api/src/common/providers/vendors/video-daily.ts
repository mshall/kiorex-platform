/**
 * Daily.co video (REST). VIDEO_PROVIDER=daily, VIDEO_API_URL=https://api.daily.co/v1, VIDEO_API_KEY (Bearer, secret), VIDEO_DOMAIN (<team>.daily.co).
 *   createRoom: POST /rooms { name, privacy:'private', properties:{ exp, enable_chat:false, enable_recording:'none' (recording OFF), max_participants:2 } } -> { name, url }
 *   issueToken: POST /meeting-tokens { properties:{ room_name, user_id (opaque hash, no PHI), is_owner, exp, enable_recording:false } } -> { token }
 * Provider choice (Daily / Twilio / Chime), region and DPA/BAA remain NEEDS_HUMAN; this is the reference REST implementation behind the VideoAdapter port.
 */
export const dailyRoomBody = (name: string, ttlSeconds: number, now = Date.now()) => ({ name, privacy: 'private', properties: { exp: Math.floor(now / 1000) + ttlSeconds, max_participants: 2, enable_chat: false, enable_recording: 'none' } });
export const dailyTokenBody = (i: { roomName: string; userId: string; owner: boolean; ttlSeconds: number }, now = Date.now()) => ({ properties: { room_name: i.roomName, user_id: i.userId, is_owner: i.owner, exp: Math.floor(now / 1000) + i.ttlSeconds, enable_recording: false } });
