-- Clinic-owned telehealth (P2P WebRTC): the booking carries the Clinic's telehealth block (session id + patient join URL + window + state).
-- No media or video-vendor data lives in Kiorex. TeleSession stays for the dev/mock path only.
ALTER TABLE "BookingIntent" ADD COLUMN "telehealth" JSONB;
