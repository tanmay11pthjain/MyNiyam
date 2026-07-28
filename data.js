// ===== KALYAN MITRA — STATIC DATA =====

// ===== TITHI NAMES =====
const TITHI_NAMES = [
  'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami',
  'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami',
  'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi', 'Purnima'
];

const TITHI_NAMES_KRISHNA = [
  'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami',
  'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami',
  'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi', 'Amavasya'
];

// ===== PAKSHA =====
const PAKSHA = {
  SHUKLA: 'Shukla Paksha',
  KRISHNA: 'Krishna Paksha'
};

// ===== JAIN MONTHS =====
const JAIN_MONTHS = [
  'Kartik', 'Margshirsh', 'Paush', 'Magha',
  'Falgun', 'Chaitra', 'Vaishakh', 'Jyeshth',
  'Ashadh', 'Shravan', 'Bhadrapad', 'Ashwin'
];

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
const DEFAULT_SETTINGS = {
  enablePooja: true,
  enableSamayik: true,
  enableNavkarsi: true,
  enablePranam: true,
  enablePratikraman: true,
  enableBookReading: true,
  enableRatriBhojan: true,
  enableKandmool: true,
  enableWakeup: true,
  enableSleep: true,
  enableScreenTime: true,
  enableDailyNiyam: true,
  currentDailyNiyamId: 0, // Index of PACHCHAKHANS array
  samayikTarget: 1,
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
  currentStreak: 0,
  longestStreak: 0,
  lastActiveDate: null,
  streakFreezeUsed: false,
  streakFreezeMonth: null,
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
const DEFAULT_DAILY_LOG = {
  date: null,
  poojaDone: false,
  ashtaPrakariDone: false,
  samayikDone: 0,
  navkarsiDone: false,
  pranamDone: false,
  devasiyaDone: false,
  raysiyaDone: false,
  bookReadingMins: 0,
  ratriBhojanDone: false,
  kandmoolDone: false,
  wakeUpDone: false,
  sleepDone: false,
  screenTimeHours: 0,
  screenTimeMins: 0,
  dailyNiyamDone: false,
  kpEarned: 0,
  perfectDay: false,
  bonuses: [],
  finalized: false,   // true once end-of-day has been processed for this date
};

// ===== POINT VALUES =====
const POINTS = {
  pooja: 20,
  ashtaPrakari: 10,
  samayik: 20, // per samayik
  navkarsi: 10,
  pranam: 20,
  devasiya: 30,
  raysiya: 30,
  bookReading: 20, // per 30 mins
  ratriBhojan: 20,
  kandmool: 20,
  wakeUpEarly: 10,
  sleepEarly: 10,
  screenTimePenalty: 5, // per hour
  dailyNiyam: 10,
  perfectDay: 50,
  dailyLogin: 10,
};

// ===== RARITY COLORS =====
const RARITY_COLORS = {
  'Common': '#6B9E6B',
  'Uncommon': '#4A90D9',
  'Rare': '#9B59B6',
  'Epic': '#E67E22',
  'Legendary': '#F1C40F',
};
