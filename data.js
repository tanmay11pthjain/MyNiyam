// ===== KALYAN MITRA — STATIC DATA =====

// ===== ACHIEVEMENT BADGES =====
const BADGES = [
  { id: 'early_riser', name: 'Early Riser', icon: '🌅', desc: 'Complete Pooja before 7 AM, 5 times', rarity: 'Common', condition: 'earlyPooja', threshold: 5 },
  { id: 'week_warrior', name: 'Week Warrior', icon: '🔥', desc: '7-day streak achieved', rarity: 'Common', condition: 'streak', threshold: 7 },
  { id: 'bookworm', name: 'Bookworm', icon: '📚', desc: 'Read 100+ pages/lines total', rarity: 'Uncommon', condition: 'totalSwadhyay', threshold: 100 },
  { id: 'samayik_master', name: 'Samayik Master', icon: '🧘', desc: '50 samayiks completed', rarity: 'Uncommon', condition: 'totalSamayik', threshold: 50 },
  { id: 'perfect_week', name: 'Perfect Week', icon: '💎', desc: 'All tasks every day for 7 days', rarity: 'Rare', condition: 'perfectDays', threshold: 7 },
  { id: 'monthly_champion', name: 'Monthly Champion', icon: '👑', desc: '30-day streak', rarity: 'Epic', condition: 'streak', threshold: 30 },
  { id: 'karma_king', name: 'Karma King', icon: '⭐', desc: 'Earn 3,500 AP total', rarity: 'Legendary', condition: 'totalKP', threshold: 3500 },
  { id: 'spiritual_warrior', name: 'Spiritual Warrior', icon: '🕉️', desc: 'Earn 2,500 AP total', rarity: 'Epic', condition: 'totalKP', threshold: 2500 },
  { id: 'pratikraman_pro', name: 'Pratikraman Pro', icon: '🙏', desc: 'Complete both daily pratikraman 20 times', rarity: 'Uncommon', condition: 'totalFullPratikraman', threshold: 20 },
  { id: 'niyam_follower', name: 'Niyam Follower', icon: '✨', desc: 'Follow daily pachchakhan 15 times', rarity: 'Common', condition: 'totalNiyam', threshold: 15 },
  { id: 'first_step', name: 'First Step', icon: '👣', desc: 'Complete your first activity', rarity: 'Common', condition: 'totalActivities', threshold: 1 },
  { id: 'century', name: 'Century', icon: '💯', desc: 'Earn 100 AP in a single day', rarity: 'Uncommon', condition: 'dailyKP', threshold: 100 },
];

// ===== PACHCHAKHAN (DAILY VOWS) =====
const PACHCHAKHANS = [
  "Aaj ke din gulab jamun ka tyag karein 🍬",
  "Aaj ke din mobile ka kam se kam upyog karein 📱",
  "Aaj ke din kisi ki ninda na karein 🤐",
  "Aaj ke din jalebi ka tyag karein 🍯",
  "Aaj ke din TV na dekhein 📺",
  "Aaj ke din chai ya coffee ka tyag karein ☕",
  "Aaj ke din mithai ka tyag karein 🍮",
  "Aaj ke din krodh na karein 😌",
  "Aaj ke din jhooth na bolein 🤞",
  "Aaj ke din chocolate ka tyag karein 🍫",
  "Aaj ke din fried food ka tyag karein 🍟",
  "Aaj ke din social media na chalayein 📵",
  "Aaj ke din ice cream ka tyag karein 🍦",
  "Aaj ke din bina zaroorat paani barbaad na karein 💧",
  "Aaj ke din kisi se ladaai na karein 🕊️",
  "Aaj ke din namak kam khayein 🧂",
  "Aaj ke din biscuit/cookies ka tyag karein 🍪",
  "Aaj ke din lift ki jagah seedhi use karein 🪜",
  "Aaj ke din online shopping na karein 🛒",
  "Aaj ke din cold drink ka tyag karein 🥤",
  "Aaj ke din raatri bhojan na karein 🌙",
  "Aaj ke din kisi ki madad zaroor karein 🤝",
  "Aaj ke din ek naya mantra yaad karein 📿",
  "Aaj ke din khade hokar paani na piyein 🚰",
  "Aaj ke din pizza/burger ka tyag karein 🍕",
  "Aaj ke din gossip na karein 🗣️",
  "Aaj ke din games na khelein 🎮",
  "Aaj ke din chini ka tyag karein 🍬",
  "Aaj ke din ek vyakti ko kshama karein 🙏",
  "Aaj ke din achaar ka tyag karein 🫙",
  "Aaj ke din paani chhankar piyein 💧",
  "Aaj ke din kisi ko daan zaroor dein 🎁",
  "Aaj ke din cake/pastry ka tyag karein 🍰",
  "Aaj ke din maun vrat rakhein (1 ghanta) 🤫",
  "Aaj ke din pani puri ka tyag karein 😋",
  "Aaj ke din kisi buzurg ki seva karein 👴",
  "Aaj ke din noodles/pasta ka tyag karein 🍝",
  "Aaj ke din YouTube na dekhein 📺",
  "Aaj ke din chips ka tyag karein 🥔",
  "Aaj ke din kisi ko phone karke haal-chaal poochein 📞",
  "Aaj ke din samosa ka tyag karein 🔺",
  "Aaj ke din subah jaldi uthein (sunrise se pehle) 🌅",
  "Aaj ke din kheer ka tyag karein 🍚",
  "Aaj ke din shopping na karein 🏬",
  "Aaj ke din halwa ka tyag karein 🍮",
  "Aaj ke din kisi se oonchi awaaz mein baat na karein 🔇",
  "Aaj ke din namkeen ka tyag karein 🥨",
  "Aaj ke din plastic ka upyog kam karein ♻️",
  "Aaj ke din paneer ka tyag karein 🧀",
  "Aaj ke din gathiya-fafda ka tyag karein 🍘",
  "Aaj ke din doosron ki burai na sunein 🙉",
  "Aaj ke din rabdi ka tyag karein 🥛",
  "Aaj ke din kisi janwar ko khana khilayein 🐦",
  "Aaj ke din barfi ka tyag karein 🍬",
  "Aaj ke din poha/upma ka tyag karein 🍛",
  "Aaj ke din music na sunein 🎵",
  "Aaj ke din paratha ka tyag karein 🫓",
  "Aaj ke din kisi ko compliment zaroor dein 😊",
  "Aaj ke din dry fruits ka tyag karein 🥜",
  "Aaj ke din pav bhaji ka tyag karein 🍞",
  "Aaj ke din chhena/rasmalai ka tyag karein 🧁",
  "Aaj ke din 10 minute dhyan zaroor karein 🧘",
  "Aaj ke din idli/dosa ka tyag karein 🫕",
  "Aaj ke din khatta khana ka tyag karein 🍋",
];

// ===== MOTIVATIONAL MESSAGES =====
const MOTIVATIONAL_MESSAGES = {
  morning: [
    "Jai Jinendra! 🙏 Nayi subah, nayi sadhana ka avsar.",
    "Aaj ka din aapki aatmik yatra mein ek aur kadam hai. 🌅",
    "Har din ek naya aarambh hai. Sadhana mein lage rahein! ✨",
    "Uttam Kshama, Uttam Mardava — Aaj ka din shubh ho! 🙏",
  ],
  progress: [
    "Bahut achha! Aap sahi raaste par hain! 🌟",
    "Aapki sadhana rang la rahi hai! Jari rakhein! 💪",
    "Karma Points badh rahe hain! Aap kar sakte hain! 🔥",
    "Ek kadam aur — Perfect Day ke nazdeek! ⭐",
  ],
  complete: [
    "🎊 Adbhut! Aaj sab kuch poora ho gaya! Perfect Day!",
    "🌟 Shaandaar! Aapne aaj apni sadhana poori ki!",
    "✨ Bahut sundar! Yeh din yaad rakhne layak hai!",
    "🏆 Champion! Aapne aaj har lakshya poora kiya!",
  ],
  streak: [
    "🔥 Aapki streak jal rahi hai! Mat todiye!",
    "🔥 Lagataar sadhana ka phal milega! Streak jaari rakhein!",
    "🔥 Streak ka har din aapko mazboot bana raha hai!",
  ],
  streakRisk: [
    "⚠️ Aapki streak khatre mein hai! Abhi activities poori karein!",
    "🔴 Din khatam hone wala hai — streak bachayein!",
    "⏰ Samay kam hai! Apni sadhana poori karein!",
  ],
  socialProof: [
    "Aap is hafte ke top 15% sadhak mein hain! 🏅",
    "Aap baaki logon se aage hain! Shandar prayas! 📈",
    "Aapki dedication kamaal ki hai! Top performer! 🌟",
    "Bahut kam log itni discipline rakhte hain — Salaam! 🙏",
  ]
};

// ===== DEFAULT SETTINGS =====
// Only the settings that aren't a niyam's enable flag. Every enable<Id>
// flag (enableNavkarsi, enablePooja, enableAshtaPrakari, …) is added by
// registerNiyams() from NIYAM_REGISTRY below, using each entry's `flag` and
// `defaultEnabled` — so switching a niyam on/off by default, or adding a
// new one, is a one-line change there rather than an edit in two files.
const DEFAULT_SETTINGS = {
  currentDailyNiyamId: 0, // Index of PACHCHAKHANS array
  samayikTarget: 1,       // referenced by the samayik entry's `targetSetting`
  introSeen: false,
};

// ===== DEFAULT LOCATION (per-user, NOT part of global settings) =====
// Used only as a last-resort fallback before any geolocation fix or Open-Meteo
// response has ever been recorded for this user.
const DEFAULT_LOCATION = {
  lat: 12.9716,
  lng: 77.5946,
  elevation: 920,       // metres — Bangalore
  timezone: 'Asia/Kolkata',
  name: 'Bangalore',
  source: 'default',    // 'default' | 'gps' | 'open-meteo'
  updatedAt: null,
};

// ===== DEFAULT PROFILE =====
const DEFAULT_PROFILE = {
  totalKP: 0,              // Raw points only — no starting bonus
  rawPointsMigrated: false, // set true after _migrateToRawPoints() has run once
  pointsVersion: 0,        // sangh_settings/{code}/pointsVersion this totalKP was last computed against
  currentStreak: 0,
  longestStreak: 0,
  lastActiveDate: null,
  streakFreezeUsed: false,
  streakFreezeMonth: null,
  streakSaversUsed: 0,      // streak-saver edits used in streakSaverMonth
  streakSaverMonth: null,   // 'YYYY-MM' the above count applies to
  badges: [],
  // Lifetime stats
  totalSamayik: 0,
  totalSwadhyay: 0,
  totalPratikraman: 0,
  totalFullPratikraman: 0,
  totalNiyam: 0,
  totalActivities: 0,
  earlyPooja: 0,
  perfectDays: 0,
  totalPerfectDays: 0,
  daysActive: 0,
};

// ===== DEFAULT DAILY LOG =====
// Only the non-niyam bookkeeping fields are listed here. Every niyam's own
// prop (navkarsiDone, samayikDone, bookReadingMins, screenTimeHours/Mins, …)
// is added by registerNiyams() from NIYAM_REGISTRY below — declaring a niyam
// there is what creates its log field, so the two can never drift apart.
// The keys that remain are also the "reserved" set registerNiyams() guards
// new niyams against colliding with.
const DEFAULT_DAILY_LOG = {
  date: null,
  kpEarned: 0,
  perfectDay: false,
  bonuses: [],
  finalized: false,   // true once end-of-day has been processed for this date
  finalizeSnapshot: null, // profile fields as they were just before finalizing, so an admin unlock can revert them exactly
};

// ===== POINT VALUES =====
// Only the two awards that aren't tied to a niyam. Every niyam's own point
// value lives on its NIYAM_REGISTRY item (`points`, keyed by `pointsKey`)
// and is folded in by _buildDefaultPointMap() in app.js.
const POINTS = {
  perfectDay: 50,
  dailyLogin: 10,
};

// ===== NIYAM REGISTRY — THE single place every niyam is defined =====
// This is the one array to edit to add, remove or change ANY niyam —
// built-in or custom. registerNiyams() (app.js) derives all of it from here:
// scoring (RAW_POINT_RULES), the log's shape (DEFAULT_DAILY_LOG), the enable
// flags (DEFAULT_SETTINGS), point values (POINTS/DEFAULT_POINT_MAP), the
// streak-saver day-edit overlay (DAY_EDIT_FIELDS), Monthly Niyam Stats, the
// lifetime grid and the Excel export (NIYAM_STATS), the admin Settings rows,
// and each card's label/Hindi/icon text. See registerNiyams()'s own comment
// for how each field is validated.
//
// TO ADD A NIYAM: append one entry. It ships DISABLED (defaultEnabled
// defaults to false), so nothing changes for existing users until a sangh
// admin opts it in from Settings.
//
// ----- entry fields -----
//   id         unique, letters/digits only, first char a letter. Becomes
//              <id>-card / btn-<id> in the DOM — NEVER rename one after
//              members have logged against it.
//   label      the niyam's name (dashboard card title + admin row)
//   adminLabel optional — admin Settings row label, when it differs
//   labelHindi Devanagari name shown under the label
//   icon       emoji on the dashboard card
//   section    'morning' | 'sadhana' | 'tyag'  (the three built-in Home
//              categories) or 'bhakti' | 'aachar' (the two newer ones)
//   layout     'simple'    one done/undo button, one item
//              'dual'      two independent toggle slots in one card
//              'dependent' a toggle + a child that only scores while the
//                          parent is done (Jin Pooja + Ashta Prakari)
//              'exclusive' two slots where picking one clears the other
//   builtIn    true = its card markup is already hand-written in index.html,
//              so no card is generated for it (its text is still driven from
//              here — see _refreshNiyamLabels()). Omit for new niyams.
//   flag       optional — explicit settings key. Defaults to enable<Id>.
//              The built-ins set it explicitly because their long-standing
//              saved keys (enableBookReading, enableScreenTime, …) don't
//              match that derivation and are live per-sangh data.
//   defaultEnabled  true = on out of the box (the built-ins). Default false.
//   hint       optional — small grey note on the admin row ("per samayik")
//
// ----- item fields (one per scoring slot) -----
//   prop       the daily_log field. MUST end in "Done" for toggle items and
//              be globally unique. NEVER rename — it keys every member's
//              logged history.
//   pointsKey  optional — the POINTS/sangh-override key. Defaults to `prop`.
//              The built-ins set it because their stored keys (navkarsi,
//              wakeUpEarly, …) differ from their props and are live data.
//   type       'toggle'     (default) boolean done/not-done
//              'counter'    a count; scores count x points (Samayik)
//              'duration'   minutes; scores floor(mins/divisor) x points
//              'screentime' a PENALTY; scores negative, never "followed"
//   points     coded default point value (admins override it per sangh)
//   label / labelHindi / icon  as shown in the day-edit overlay, stats,
//              History and the export. `icon` may differ from the card's.
//   dependsOn  (dependent layout's child only) the sibling item's prop
//   divisor    (duration) minutes per award — 30 for Book Reading
//   minsProp   (screentime) the sibling minutes field
//   targetSetting (counter) settings key holding the "counts as done"
//              threshold — samayikTarget for Samayik
//   step/unit  day-edit overlay stepper size and unit label
const NIYAM_REGISTRY = [
  // ===================================================================
  // BUILT-IN NIYAMS — cards hand-written in index.html (builtIn: true).
  // Their prop names, pointsKeys and flags are LIVE STORED DATA and must
  // never change; everything else here is safe to edit.
  // ===================================================================

  // ----- 🌅 Morning Rituals -----
  {
    id: 'navkarsi', label: 'Navkarsi', labelHindi: 'नवकारसी', icon: '🚰',
    section: 'morning', layout: 'simple', builtIn: true,
    flag: 'enableNavkarsi', defaultEnabled: true,
    items: [{ prop: 'navkarsiDone', pointsKey: 'navkarsi', label: 'Navkarsi', labelHindi: 'नवकारसी', icon: '🌅', points: 10 }]
  },
  {
    id: 'wakeup', label: 'Wake < 7AM', adminLabel: 'Wake up < 7AM', labelHindi: '7AM से पहले उठें', icon: '🌅',
    section: 'morning', layout: 'simple', builtIn: true,
    flag: 'enableWakeup', defaultEnabled: true,
    items: [{ prop: 'wakeUpDone', pointsKey: 'wakeUpEarly', label: 'Wake < 7AM', labelHindi: '7AM से पहले उठें', icon: '⏰', points: 10 }]
  },
  {
    id: 'sleep', label: 'Sleep < 12AM', labelHindi: '12AM से पहले सो जाएं', icon: '🌙',
    section: 'morning', layout: 'simple', builtIn: true,
    flag: 'enableSleep', defaultEnabled: true,
    items: [{ prop: 'sleepDone', pointsKey: 'sleepEarly', label: 'Sleep < 12AM', labelHindi: '12AM से पहले सो जाएं', icon: '🌙', points: 10 }]
  },
  {
    id: 'pranam', label: 'Mata Pita Pranam', labelHindi: 'माता-पिता प्रणाम', icon: '🙇',
    section: 'morning', layout: 'simple', builtIn: true,
    flag: 'enablePranam', defaultEnabled: true,
    items: [{ prop: 'pranamDone', pointsKey: 'pranam', label: 'Pranam', labelHindi: 'माता पिता प्रणाम', icon: '🙇', points: 10 }]
  },

  // ----- 🧘 Sadhana -----
  {
    id: 'pooja', label: 'Jin Pooja', labelHindi: 'जिनपूजा', icon: '🪔',
    section: 'sadhana', layout: 'dependent', builtIn: true,
    flag: 'enablePooja', defaultEnabled: true,
    items: [
      { prop: 'poojaDone', pointsKey: 'pooja', label: 'Jin Pooja', labelHindi: 'जिन पूजा', icon: '🪔', points: 10 },
      // countsWithoutParent preserves this niyam's long-standing quirk: it
      // scores 0 unless Jin Pooja is also done, but has always still counted
      // as "followed" in stats/export. See registerNiyams() for why that
      // inconsistency is preserved explicitly rather than silently changed.
      { prop: 'ashtaPrakariDone', pointsKey: 'ashtaPrakari', flag: 'enableAshtaPrakari', label: 'Ashta Prakari', labelHindi: 'अष्टप्रकारी पूजा', icon: '🍽️', points: 50, dependsOn: 'poojaDone', countsWithoutParent: true },
    ]
  },
  {
    id: 'samayik', label: 'Samayik', labelHindi: 'सामायिक', icon: '🧘',
    section: 'sadhana', layout: 'simple', builtIn: true,
    flag: 'enableSamayik', defaultEnabled: true, hint: 'per samayik',
    items: [{ prop: 'samayikDone', pointsKey: 'samayik', type: 'counter', targetSetting: 'samayikTarget', step: 1, label: 'Samayik', labelHindi: 'सामायिक', icon: '🧘', points: 10 }]
  },
  {
    id: 'pratikraman', label: 'Pratikraman', labelHindi: 'प्रतिक्रमण', adminLabelHindi: 'प्रतिक्रमण — देवसिय', icon: '🙏',
    section: 'sadhana', layout: 'dual', builtIn: true,
    flag: 'enablePratikraman', defaultEnabled: true,
    items: [
      { prop: 'devasiyaDone', pointsKey: 'devasiya', label: 'Devasiya', labelHindi: 'देवसिय', icon: '🌅', points: 10 },
      { prop: 'raiyaDone', pointsKey: 'raiya', flag: 'enableRaiya', label: 'Raiya', labelHindi: 'राईअ', icon: '🌙', points: 10 },
    ]
  },
  {
    id: 'book', label: 'Dharmik Book Reading (30m)', adminLabel: 'Book Reading', labelHindi: 'धार्मिक पुस्तक पढ़ना', icon: '📖',
    section: 'sadhana', layout: 'simple', builtIn: true,
    flag: 'enableBookReading', defaultEnabled: true, hint: 'per 30 min',
    items: [{ prop: 'bookReadingMins', pointsKey: 'bookReading', type: 'duration', divisor: 30, step: 30, unit: 'min', label: 'Book Reading', labelHindi: 'धार्मिक पुस्तक पढ़ना', icon: '📖', points: 20 }]
  },

  // ----- 🛡️ Tyag & Discipline -----
  {
    id: 'ratribhojan', label: 'Ratri Bhojan Tyag', labelHindi: 'रात्रि भोजन त्याग', icon: '🚫',
    section: 'tyag', layout: 'simple', builtIn: true,
    flag: 'enableRatriBhojan', defaultEnabled: true,
    items: [{ prop: 'ratriBhojanDone', pointsKey: 'ratriBhojan', label: 'Ratri Bhojan Tyag', labelHindi: 'रात्रि भोजन त्याग', icon: '🍽️', points: 10 }]
  },
  {
    id: 'kandmool', label: 'Kandmool Tyag', labelHindi: 'कंदमूल त्याग', icon: '🥔',
    section: 'tyag', layout: 'simple', builtIn: true,
    flag: 'enableKandmool', defaultEnabled: true,
    items: [{ prop: 'kandmoolDone', pointsKey: 'kandmool', label: 'Kandmool Tyag', labelHindi: 'कंदमूल त्याग', icon: '🌱', points: 10 }]
  },
  {
    id: 'screentime', label: 'Screen Time', adminLabel: 'Screen Time Tracking', labelHindi: 'स्क्रीन टाइम', icon: '📱',
    section: 'tyag', layout: 'simple', builtIn: true,
    flag: 'enableScreenTime', defaultEnabled: true, hint: 'penalty per hour',
    items: [{ prop: 'screenTimeHours', minsProp: 'screenTimeMins', pointsKey: 'screenTimePenalty', type: 'screentime', label: 'Screen Time', labelHindi: 'स्क्रीन टाइम', icon: '📱', points: 5 }]
  },
  {
    id: 'dailyniyam', label: 'Aaj Ka Niyam', adminLabel: 'Enable Daily Niyam', labelHindi: 'दैनिक नियम', icon: '✨',
    section: 'tyag', layout: 'simple', builtIn: true,
    flag: 'enableDailyNiyam', defaultEnabled: true,
    items: [{ prop: 'dailyNiyamDone', pointsKey: 'dailyNiyam', label: 'Daily Niyam', labelHindi: 'दैनिक नियम', icon: '✨', points: 10 }]
  },

  // ===================================================================
  // CUSTOM NIYAMS — cards generated automatically from these entries.
  // Ship disabled; a sangh admin opts each one in from Settings.
  // ===================================================================

  // ----- 🙏 Dev-Guru Bhakti -----
  {
    id: 'navkarJaap', label: 'Navkar Jaap', labelHindi: 'नवकार जाप', icon: '📿',
    section: 'bhakti', layout: 'dual',
    items: [
      { prop: 'navkarJaapMorningDone', label: 'Morning (8)', labelHindi: 'सुबह', icon: '🌅', points: 10 },
      { prop: 'navkarJaapNightDone', label: 'Night (7)', labelHindi: 'रात', icon: '🌙', points: 10 },
    ]
  },
  {
    id: 'devDarshan', label: 'Dev Darshan', labelHindi: 'देव दर्शन', icon: '🛕',
    section: 'bhakti', layout: 'dependent',
    items: [
      { prop: 'devDarshanDone', label: 'Dev Darshan', labelHindi: 'देव दर्शन', icon: '🛕', points: 10 },
      { prop: 'chaityaVandanDone', label: 'Vidhi Sahit Chaitya Vandan', labelHindi: 'विधि सहित चैत्यवंदन', icon: '🙏', points: 20, dependsOn: 'devDarshanDone' },
    ]
  },
  {
    id: 'guruVandan', label: 'Guru Vandan', labelHindi: 'गुरु वंदन', icon: '🙇',
    section: 'bhakti', layout: 'exclusive',
    items: [
      { prop: 'guruVandanHajirDone', label: 'Hajir', labelHindi: 'हाजिर साधु भगवंत को', icon: '🙇', points: 20 },
      { prop: 'guruVandanMurtiDone', label: 'Murti/Photo', labelHindi: 'मूर्ति/फोटो द्वारा', icon: '🖼️', points: 10 },
    ]
  },
  {
    id: 'shaamAarti', label: 'Shaam ki Aarti', labelHindi: 'शाम की आरती', icon: '🪔',
    section: 'bhakti', layout: 'simple',
    items: [{ prop: 'shaamAartiDone', label: 'Shaam ki Aarti', labelHindi: 'शाम की आरती', icon: '🪔', points: 20 }]
  },
  {
    id: 'khamasmne', label: 'Pathshala me padne ke purv Gyaan ke 5 Khamasmne', labelHindi: 'पाठशाला में पढ़ने के पूर्व ज्ञान के 5 खमासमणा', icon: '🙌',
    section: 'bhakti', layout: 'simple',
    items: [{ prop: 'khamasmneDone', label: 'Pathshala me padne ke purv Gyaan ke 5 Khamasmne', labelHindi: 'पाठशाला में पढ़ने के पूर्व ज्ञान के 5 खमासमणा', icon: '🙌', points: 10 }]
  },
  // ----- ⭐ Aachar -----
  {
    id: 'katasna', label: 'Pathshala me Katasna & Thavni ka upyog', labelHindi: 'पाठशाला में कटासणा व ठवणी का उपयोग', icon: '🪵',
    section: 'aachar', layout: 'simple',
    items: [{ prop: 'katasnaDone', label: 'Pathshala me Katasna & Thavni ka upyog', labelHindi: 'पाठशाला में कटासणा व ठवणी का उपयोग', icon: '🪵', points: 10 }]
  },
  {
    id: 'annadaan', label: 'Din me kam se kam ek baar kisi ko dene ke baad khana', labelHindi: 'दिन में कम से कम एक बार किसी को देके खाना', icon: '🍎',
    section: 'aachar', layout: 'simple',
    items: [{ prop: 'annadaanDone', label: 'Din me kam se kam ek baar kisi ko dene ke baad khana', labelHindi: 'दिन में कम से कम एक बार किसी को देके खाना', icon: '🍎', points: 10 }]
  },
  {
    id: 'supatraDaan', label: 'Supatra Daan', labelHindi: 'सुपात्र दान', icon: '🤲',
    section: 'aachar', layout: 'simple',
    items: [{ prop: 'supatraDaanDone', label: 'Supatra Daan', labelHindi: 'सुपात्र दान', icon: '🤲', points: 10 }]
  },
  {
    id: 'aksharTyag', label: 'Aksharwale kapde nahi pehnana aur paper me nahi khana', labelHindi: 'अक्षरवाले कपडे नहीं पहनना और पेपर में नहीं खाना', icon: '👕',
    section: 'aachar', layout: 'simple',
    items: [{ prop: 'aksharTyagDone', label: 'Aksharwale kapde nahi pehnana aur paper me nahi khana', labelHindi: 'अक्षरवाले कपडे नहीं पहनना और पेपर में नहीं खाना', icon: '👕', points: 10 }]
  },
  {
    id: 'bhojanVivek', label: 'Bina TV/Mobile dekhe Bhojan karna', labelHindi: 'बिना टीवी/मोबाइल देखे भोजन करना', icon: '🍽️',
    section: 'aachar', layout: 'simple',
    items: [{ prop: 'bhojanVivekDone', label: 'Bina TV/Mobile dekhe Bhojan karna', labelHindi: 'बिना टीवी/मोबाइल देखे भोजन करना', icon: '🍽️', points: 20 }]
  },
  {
    id: 'thaliDhona', label: 'Thali Katori Dhokar Peena-Luchna', labelHindi: 'थाली कटोरी धोकर पीना-लुंछना', icon: '🥣',
    section: 'aachar', layout: 'simple',
    items: [{ prop: 'thaliDhonaDone', label: 'Thali Katori Dhokar Peena-Luchna', labelHindi: 'थाली कटोरी धोकर पीना-लुंछना', icon: '🥣', points: 20 }]
  },
  {
    id: 'dharmikKahani', label: 'Dharmik Kahani sunana (15 min)', labelHindi: 'धार्मिक कहानी सुनना', icon: '👪',
    section: 'aachar', layout: 'simple',
    items: [{ prop: 'dharmikKahaniDone', label: 'Dharmik Kahani sunana (15 min)', labelHindi: 'धार्मिक कहानी सुनना', icon: '👪', points: 20 }]
  },
  {
    id: 'packagedTyag', label: 'Bread/Pizza/Cheese/Pav/Butter/Honey/\nMayonnaise/Chocolate/Ice-cream ka Tyag', labelHindi: 'ब्रेड-पाव-पिज़्ज़ा-चीज़-बटर-शहद-चॉकलेट-आइस क्रीम का त्याग', icon: '🍕',
    section: 'aachar', layout: 'simple',
    items: [{ prop: 'packagedTyagDone', label: 'Bread/Pizza/Cheese/Pav/Butter/Honey/Mayonnaise/Chocolate/Ice-cream ka Tyag', labelHindi: 'ब्रेड-पाव-पिज़्ज़ा-चीज़-बटर-शहद-चॉकलेट-आइस क्रीम का त्याग', icon: '🍕', points: 20 }]
  },
  {
    id: 'vyavastha', label: 'Cheezein Sahi Jagah par rakhe', labelHindi: 'चीज़ें सही जगह रखना', icon: '🧹',
    section: 'aachar', layout: 'simple',
    items: [{ prop: 'vyavasthaDone', label: 'Cheezein Sahi Jagah par rakhe', labelHindi: 'चीज़ें सही जगह रखना', icon: '🧹', points: 10 }]
  },
  {
    id: 'badoKiSeva', label: 'Bado ki Seva (15 min)', labelHindi: 'बड़ों की सेवा', icon: '👵',
    section: 'aachar', layout: 'simple',
    items: [{ prop: 'badoKiSevaDone', label: 'Bado ki Seva (15 min)', labelHindi: 'बड़ों की सेवा', icon: '👵', points: 20 }]
  },

  // ------Tap--------
  {
    id: 'tap', label: 'Tapasya', labelHindi: 'तपस्या', icon: '🧘',
    section: 'aachar', layout: 'exclusive',
    items: [
      { prop: 'BiyasanaDone', label: 'Biyasana', labelHindi: 'बियासना', icon: '2️⃣', points: 20 },
      { prop: 'EkasanaDone', label: 'Ekasana', labelHindi: 'एकसाना', icon: '1️⃣', points: 30 },
      { prop: 'AyambilDone', label: 'Ayambil', labelHindi: 'आयम्बिल', icon: '🧂', points: 40 },
      { prop: 'UpvasDone', label: 'Upvas', labelHindi: 'उपवास', icon: '⭐', points: 50 },
    ]
  },
];

// ===== STREAK SAVER =====
const STREAK_SAVERS_PER_MONTH = 3;

// ===== RARITY COLORS =====
const RARITY_COLORS = {
  'Common': '#6B9E6B',
  'Uncommon': '#4A90D9',
  'Rare': '#9B59B6',
  'Epic': '#E67E22',
  'Legendary': '#F1C40F',
};
