/**
 * VidDrop music library — 85 tracks across 9 categories.
 *
 * Source: VidDrop Supabase DB (music_categories + music_tracks), exported 2026-07-02.
 * Storage: Wasabi bucket `sqd-upload-portal`, prefix `viddrop_assets/music/`.
 * Format: AAC in .m4a containers (one .mp3), publicly readable, no presigning needed.
 * sort_order matches the VidDrop DB (starts at 60, steps by 10).
 */

export interface MusicTrack {
  id:               string
  name:             string
  genre:            string
  url:              string
  duration_seconds: number
}

export const MUSIC_GENRES = [
  'Chill Urban',
  'Cinematic Hip-Hop',
  'Gospel Trap',
  'Hopeful',
  'Modern Ambient',
  'Neo-Soul',
  'Organic Acoustic',
  'Reflective',
  'Underscore',
] as const

export type MusicGenre = typeof MUSIC_GENRES[number]

export const MUSIC_LIBRARY: MusicTrack[] = [
  // ── Chill Urban (sort_order 60) ───────────────────────────────────────
  { id: '1782349415136', name: 'Dusty Rhodes Bed',    genre: 'Chill Urban', duration_seconds: 132, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349415136-Dusty_Rhodes_Bed.m4a' },
  { id: '1782349417328', name: 'Midnight Sermon',     genre: 'Chill Urban', duration_seconds: 119, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349417328-Midnight_Sermon.m4a' },
  { id: '1782349417982', name: 'Sunday Cushion',      genre: 'Chill Urban', duration_seconds: 115, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349417982-Sunday_Cushion.m4a' },
  { id: '1782349418590', name: 'Sunday Dust',         genre: 'Chill Urban', duration_seconds: 104, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349418590-Sunday_Dust.m4a' },
  { id: '1782349416262', name: 'Sunday on Rhodes',    genre: 'Chill Urban', duration_seconds: 103, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349416262-Sunday_on_Rhodes.m4a' },
  { id: '1782349419306', name: 'Sunday Ridge',        genre: 'Chill Urban', duration_seconds: 126, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349419306-Sunday_Ridge.m4a' },
  { id: '1782349416834', name: 'Sunday Vinyl Bench',  genre: 'Chill Urban', duration_seconds:  90, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349416834-Sunday_Vinyl_Bench.m4a' },

  // ── Cinematic Hip-Hop (sort_order 70) ────────────────────────────────
  { id: '1782349744907', name: 'Glass City Drift',      genre: 'Cinematic Hip-Hop', duration_seconds: 142, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349744907-Glass_City_Drift.m4a' },
  { id: '1782349745732', name: 'Glassline At Dusk',     genre: 'Cinematic Hip-Hop', duration_seconds: 153, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349745732-Glassline_At_Dusk.m4a' },
  { id: '1782349746316', name: 'Glassline Ransom',      genre: 'Cinematic Hip-Hop', duration_seconds: 180, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349746316-Glassline_Ransom.m4a' },
  { id: '1782349746863', name: 'Harbor Under Glass',    genre: 'Cinematic Hip-Hop', duration_seconds: 129, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349746863-Harbor_Under_Glass.m4a' },
  { id: '1782349747470', name: 'Midnight Ledger',       genre: 'Cinematic Hip-Hop', duration_seconds: 144, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349747470-Midnight_Ledger.m4a' },
  { id: '1782349747968', name: 'Night Run Protocol',    genre: 'Cinematic Hip-Hop', duration_seconds: 160, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349747968-Night_Run_Protocol.m4a' },
  { id: '1782349748595', name: 'Under Concrete Skies',  genre: 'Cinematic Hip-Hop', duration_seconds: 108, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349748595-Under_Concrete_Skies.m4a' },

  // ── Gospel Trap (sort_order 80) ───────────────────────────────────────
  { id: '1782349977658', name: 'Groovy Flow',              genre: 'Gospel Trap', duration_seconds: 143, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349977658-Groovy_Flow.m4a' },
  { id: '1782349978682', name: 'Harbor Light Bed',         genre: 'Gospel Trap', duration_seconds: 180, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349978682-Harbor_Light_Bed.m4a' },
  { id: '1782349979431', name: 'Moonlight Waves',          genre: 'Gospel Trap', duration_seconds: 104, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349979431-Moonlight_Waves.m4a' },
  { id: '1782349979967', name: 'Quiet Amen',               genre: 'Gospel Trap', duration_seconds: 180, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349979967-Quiet_Amen.m4a' },
  { id: '1782349980527', name: 'Quiet Testament Groove',   genre: 'Gospel Trap', duration_seconds: 170, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349980527-Quiet_Testament_Groove.m4a' },
  { id: '1782349981141', name: 'Still Waters City',        genre: 'Gospel Trap', duration_seconds: 106, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349981141-Still_Waters_City.m4a' },
  { id: '1782349981582', name: 'The Light Is Here',        genre: 'Gospel Trap', duration_seconds: 180, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349981582-The_Light_Is_Here.m4a' },

  // ── Hopeful (sort_order 90) ───────────────────────────────────────────
  { id: '1782350132994', name: 'C Major Hope',        genre: 'Hopeful', duration_seconds: 175, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350132994-C_Major_Hope.m4a' },
  { id: '1782350134021', name: 'Gentle Morning Rise', genre: 'Hopeful', duration_seconds: 151, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350134021-Gentle_Morning_Rise.m4a' },
  { id: '1782350135808', name: 'Hopeful Sunrise',     genre: 'Hopeful', duration_seconds: 129, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350135808-Open_Hands_Rising_1.m4a' },
  { id: '1782350134615', name: 'Open Hands Dawn',     genre: 'Hopeful', duration_seconds: 149, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350134615-Open_Hands_Dawn.m4a' },
  { id: '1782350135147', name: 'Open Hands Rise',     genre: 'Hopeful', duration_seconds: 171, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350135147-Open_Hands_Rise.m4a' },
  { id: '1782350137102', name: 'Open Hands Rising',   genre: 'Hopeful', duration_seconds: 113, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350137102-Open_Hands_Rising.m4a' },
  { id: '1782350137719', name: 'Open Sky Offering',   genre: 'Hopeful', duration_seconds: 134, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350137719-Open_Sky_Offering.m4a' },
  { id: '1782350138405', name: 'Open Sky Path',       genre: 'Hopeful', duration_seconds: 142, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350138405-Open_Sky_Path.m4a' },

  // ── Modern Ambient (sort_order 100) ──────────────────────────────────
  { id: '1782349711135', name: 'Cathedral Drift',       genre: 'Modern Ambient', duration_seconds: 130, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349711135-Cathedral_Drift.m4a' },
  { id: '1782349711950', name: 'Dreamy Scene',          genre: 'Modern Ambient', duration_seconds: 184, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349711950-Dreamy_Scene.m4a' },
  { id: '1782349708744', name: 'Hollow Chapel Drift',   genre: 'Modern Ambient', duration_seconds: 190, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349708744-Hollow_Chapel_Drift.m4a' },
  { id: '1782349706733', name: 'Horizon Veil',          genre: 'Modern Ambient', duration_seconds: 205, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349706733-Horizon_Veil.m4a' },
  { id: '1782349709326', name: 'Quiet Aerial Veil',     genre: 'Modern Ambient', duration_seconds: 169, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349709326-Quiet_Aerial_Veil.m4a' },
  { id: '1782349712599', name: 'Silent Halo',           genre: 'Modern Ambient', duration_seconds: 189, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349712599-Silent_Halo.m4a' },
  { id: '1782349713140', name: 'Vastly Open Chapel',    genre: 'Modern Ambient', duration_seconds: 160, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349713140-Vastly_Open_Chapel.m4a' },
  { id: '1782349710355', name: 'Veil of Distant Keys',  genre: 'Modern Ambient', duration_seconds: 479, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349710355-Veil_of_Distant_Keys.m4a' },
  { id: '1782349707985', name: 'Warm Drift Chapel',     genre: 'Modern Ambient', duration_seconds: 194, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349707985-Warm_Drift_Chapel.m4a' },

  // ── Neo-Soul (sort_order 110) ─────────────────────────────────────────
  { id: '1782349541537', name: 'A Chapel Groove',      genre: 'Neo-Soul', duration_seconds: 209, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349541537-A_Chapel_Groove.m4a' },
  { id: '1782349544975', name: 'Gental Light',         genre: 'Neo-Soul', duration_seconds: 199, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349544975-Gental_Light.m4a' },
  { id: '1782349542861', name: 'Grovy Night',          genre: 'Neo-Soul', duration_seconds: 169, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349542861-Grovy_Night.m4a' },
  { id: '1782349540535', name: 'Moonlight Jam',        genre: 'Neo-Soul', duration_seconds: 178, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349540535-Moonlight_Jam.m4a' },
  { id: '1782349543515', name: 'Nighttime Sanctuary',  genre: 'Neo-Soul', duration_seconds: 189, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349543515-Nighttime_Sanctuary.m4a' },
  { id: '1782349544292', name: 'Soft Sanctuary',       genre: 'Neo-Soul', duration_seconds: 214, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349544292-Soft_Sanctuary.m4a' },
  { id: '1782349542205', name: 'The Light Within',     genre: 'Neo-Soul', duration_seconds: 180, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349542205-The_Light_Within.m4a' },
  { id: '1782349545687', name: 'Velvet Amen',          genre: 'Neo-Soul', duration_seconds: 203, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782349545687-Velvet_Amen.m4a' },

  // ── Organic Acoustic (sort_order 120) ────────────────────────────────
  { id: '1782350272071', name: 'Acoustic Dreams',              genre: 'Organic Acoustic', duration_seconds: 154, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350272071-Acoustic_Dreams.m4a' },
  { id: '1782416263478', name: 'Acoustic Evening',             genre: 'Organic Acoustic', duration_seconds: 172, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782416263478-Acoustic_Evening.m4a' },
  { id: '1782416264532', name: 'Dancing Light',                genre: 'Organic Acoustic', duration_seconds: 154, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782416264532-Dancing_Light.m4a' },
  { id: '1782350272710', name: 'Hands At Dawn',                genre: 'Organic Acoustic', duration_seconds: 165, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350272710-Hands_At_Dawn.m4a' },
  { id: '1782350275017', name: 'Heart and Hand',               genre: 'Organic Acoustic', duration_seconds: 145, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350275017-Heart_and_Hand.m4a' },
  { id: '1782350274367', name: 'Held In Your Hands',           genre: 'Organic Acoustic', duration_seconds: 159, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350274367-Held_In_Your_Hands.m4a' },
  { id: '1782350270726', name: 'Night Song',                   genre: 'Organic Acoustic', duration_seconds: 140, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350270726-Night_Song.m4a' },
  { id: '1782350276239', name: 'Nylon Light',                  genre: 'Organic Acoustic', duration_seconds: 128, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350276239-Nylon_Light.m4a' },
  { id: '1782350276714', name: 'Open Handed Prayer',           genre: 'Organic Acoustic', duration_seconds: 158, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350276714-Open_Handed_Prayer.m4a' },
  { id: '1782350277326', name: 'Open Hands',                   genre: 'Organic Acoustic', duration_seconds: 170, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350277326-Open_Hands.m4a' },
  { id: '1782350277857', name: 'Quiet Lantern',                genre: 'Organic Acoustic', duration_seconds: 139, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350277857-Quiet_Lantern.m4a' },
  { id: '1782416267448', name: 'The Light That Stays',         genre: 'Organic Acoustic', duration_seconds: 172, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782416267448-The_Light_That_Stays.m4a' },
  { id: '1782416265874', name: 'The Morning Light',            genre: 'Organic Acoustic', duration_seconds: 130, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782416265874-The_Morning_Light.m4a' },
  { id: '1782416266817', name: 'The Quiet Before the Light',   genre: 'Organic Acoustic', duration_seconds: 153, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782416266817-The_Quiet_Before_the_Light.m4a' },
  { id: '1782350278379', name: 'Warm Felt Prayer',             genre: 'Organic Acoustic', duration_seconds: 142, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350278379-Warm_Felt_Prayer.m4a' },
  { id: '1782416265198', name: 'Warm Waters Night',            genre: 'Organic Acoustic', duration_seconds: 185, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782416265198-Warm_Waters_Night.m4a' },

  // ── Reflective (sort_order 130) ───────────────────────────────────────
  { id: '1782350306405', name: 'Candlelit Room',          genre: 'Reflective', duration_seconds: 164, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350306405-Candlelit_Room.m4a' },
  { id: '1782350306985', name: 'Dawn in D',               genre: 'Reflective', duration_seconds: 192, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350306985-Dawn_in_D.m4a' },
  { id: '1782350305652', name: 'Dawn Prayer Room',        genre: 'Reflective', duration_seconds: 202, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350305652-Dawn_Prayer_Room.m4a' },
  { id: '1782350307550', name: 'Lantern Psalm',           genre: 'Reflective', duration_seconds: 207, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350307550-Lantern_Psalm.mp3' },
  { id: '1782350308352', name: 'Peace and Still',         genre: 'Reflective', duration_seconds: 175, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350308352-Peace_and_Still.m4a' },
  { id: '1782350308940', name: 'Quiet Chapel Air',        genre: 'Reflective', duration_seconds: 209, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350308940-Quiet_Chapel_Air.m4a' },
  { id: '1782350309500', name: 'Quiet in G Major',        genre: 'Reflective', duration_seconds: 149, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350309500-Quiet_in_G_Major.m4a' },
  { id: '1782350309998', name: 'Quiet Mercy',             genre: 'Reflective', duration_seconds: 165, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350309998-Quiet_Mercy.m4a' },
  { id: '1782350310534', name: 'Quiet Prayer Room',       genre: 'Reflective', duration_seconds: 160, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350310534-Quiet_Prayer_Room.m4a' },
  { id: '1782350311324', name: 'Still Water Room',        genre: 'Reflective', duration_seconds: 175, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350311324-Still_Water_Room.m4a' },

  // ── Underscore (sort_order 140) ───────────────────────────────────────
  { id: '1782350492459', name: 'C Major Drift',      genre: 'Underscore', duration_seconds: 185, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350492459-C_Major_Drift.m4a' },
  { id: '1782350493763', name: 'Cozy Dream',         genre: 'Underscore', duration_seconds:  60, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350493763-Cozy_Dream.m4a' },
  { id: '1782350494333', name: 'Daytime Dream',      genre: 'Underscore', duration_seconds: 193, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350494333-Daytime_Dream.m4a' },
  { id: '1782350494973', name: 'E Minor Drift',      genre: 'Underscore', duration_seconds: 198, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350494973-E_Minor_Drift.m4a' },
  { id: '1782350495745', name: 'Elegance',           genre: 'Underscore', duration_seconds: 149, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350495745-Elegance.m4a' },
  { id: '1782350496346', name: 'Glass Room Drift',   genre: 'Underscore', duration_seconds: 173, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350496346-Glass_Room_Drift.m4a' },
  { id: '1782350496905', name: 'Horizon Glass',      genre: 'Underscore', duration_seconds: 189, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350496905-Horizon_Glass.m4a' },
  { id: '1782350497630', name: 'Open Window Room',   genre: 'Underscore', duration_seconds: 149, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350497630-Open_Window_Room.m4a' },
  { id: '1782350498181', name: 'Paper Moon Drift',   genre: 'Underscore', duration_seconds: 185, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350498181-Paper_Moon_Drift.m4a' },
  { id: '1782350498748', name: 'Piano Summer',       genre: 'Underscore', duration_seconds: 194, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350498748-Piano_Summer.m4a' },
  { id: '1782350499271', name: 'Warm D Drift',       genre: 'Underscore', duration_seconds: 182, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350499271-Warm_D_Drift.m4a' },
  { id: '1782350499962', name: 'Warm Room Tone',     genre: 'Underscore', duration_seconds: 145, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350499962-Warm_Room_Tone.m4a' },
  { id: '1782350500496', name: 'Waterfall Moon',     genre: 'Underscore', duration_seconds: 199, url: 'https://sqd-upload-portal.s3.us-central-1.wasabisys.com/viddrop_assets/music/1782350500496-Waterfall_Moon.m4a' },
]

/** Format seconds as M:SS for display. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
