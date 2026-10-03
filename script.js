import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { AdMob, BannerAdSize, BannerAdPosition, RewardAdPluginEvents } from '@capacitor-community/admob';
import { Haptics, ImpactStyle } from '@capacitor/haptics'; 
import { StatusBar } from '@capacitor/status-bar';
import LevelManager, {
    createCheckpointSnapshot,
    getChallengeProfile,
    getLiveEconomy
} from '/levelManager.js';
import { themes } from '/themes.js'; 

setLogLevel('error');

// --- ADMOB CONFIGURATION ---
const ADMOB_IDS = {
    android: {
        banner: import.meta.env.VITE_ADMOB_ANDROID_BANNER_ID,
        rewarded: import.meta.env.VITE_ADMOB_ANDROID_REWARDED_ID,
        interstitial: import.meta.env.VITE_ADMOB_ANDROID_INTERSTITIAL_ID
    },
    ios: {
        banner: import.meta.env.VITE_ADMOB_IOS_BANNER_ID,
        rewarded: import.meta.env.VITE_ADMOB_IOS_REWARDED_ID,
        interstitial: import.meta.env.VITE_ADMOB_IOS_INTERSTITIAL_ID
    }
};

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let app, db, auth, userId = null, firestoreReady = false;
let highScoresRef = null;

// --- Ad Manager Class ---
class AdManager {
    constructor() {
        this.isReady = false;
        this.platform = (/(android)/i.test(navigator.userAgent)) ? 'android' : 'ios';
        this.rewardLoaded = false;
        this.interstitialLoaded = false;
        this.lastInterstitialShownAt = 0;
        this.init();
    }

    async init() {
        try {
            await AdMob.initialize({
                requestTrackingAuthorization: true, 
                initializeForTesting: true 
            });
            try { await StatusBar.hide(); } catch (err) {}
            this.isReady = true;
            console.log("AdMob DEBUG: Initialized Native plugin successfully.");
            this.prepareReward(); 
            this.prepareInterstitial();
        } catch (e) {
            console.log("AdMob DEBUG: Failed to initialize (likely browser)", e);
            this.isReady = false;
        }
    }

    async showBanner() {
        if (!this.isReady) return;
        try {
            await AdMob.showBanner({
                adId: ADMOB_IDS[this.platform].banner,
                adSize: BannerAdSize.BANNER,
                position: BannerAdPosition.BOTTOM,
                margin: 0,
                isTesting: false 
            });
        } catch (e) {}
    }

    async hideBanner() {
        if (!this.isReady) return;
        try {
            await AdMob.hideBanner();
            await AdMob.removeBanner(); 
        } catch (e) {}
    }

    async prepareReward() {
        if (!this.isReady) return;
        console.log("AdMob DEBUG: Starting rewarded ad preparation...");
        this.rewardLoaded = false; // Reset status while loading
        try {
            await AdMob.prepareRewardVideoAd({
                adId: ADMOB_IDS[this.platform].rewarded,
                isTesting: false
            });
            this.rewardLoaded = true;
            console.log("AdMob DEBUG: Rewarded ad successfully loaded and ready.");
        } catch (e) {
            console.error("AdMob DEBUG: Failed to load rewarded ad during preparation.", e);
            this.rewardLoaded = false;
        }
    }

    async prepareInterstitial() {
        const adId = ADMOB_IDS[this.platform].interstitial;
        if (!this.isReady || !adId) return;

        this.interstitialLoaded = false;
        try {
            await AdMob.prepareInterstitial({
                adId,
                isTesting: false
            });
            this.interstitialLoaded = true;
            console.log("AdMob DEBUG: Interstitial ad loaded and ready.");
        } catch (e) {
            console.warn("AdMob DEBUG: Failed to load interstitial ad.", e);
        }
    }

    async showInterstitial() {
        const minimumInterval = 90 * 1000;
        if (
            !this.isReady ||
            !this.interstitialLoaded ||
            Date.now() - this.lastInterstitialShownAt < minimumInterval
        ) {
            return false;
        }

        this.interstitialLoaded = false;
        try {
            await AdMob.showInterstitial();
            this.lastInterstitialShownAt = Date.now();
            return true;
        } catch (e) {
            console.warn("AdMob DEBUG: Failed to show interstitial ad.", e);
            return false;
        } finally {
            this.prepareInterstitial();
        }
    }

    async showRewarded(onReward) {
        if (!this.isReady) {
            console.log("AdMob DEBUG: Simulating Rewarded Ad (browser fallback)...");
            setTimeout(() => { onReward(); }, 1000);
            return;
        }

        // 1. If ad is not loaded, attempt to load it synchronously (which is internally async).
        if (!this.rewardLoaded) {
            console.warn("AdMob DEBUG: Ad not loaded. Attempting forced reload before showing.");
            await this.prepareReward();
            
            if (!this.rewardLoaded) {
                 console.error("AdMob DEBUG: Forced reload failed. Unblocking user.");
                 // Unblock user immediately since the ad is unavailable.
                 onReward();
                 return;
            }
        }
        
        // 2. Ad is loaded. Set up event listener and show.
        const handler = AdMob.addListener(RewardAdPluginEvents.Rewarded, (reward) => {
            console.log("AdMob DEBUG: Reward granted by user/AdMob.");
            onReward();
            handler.remove();
            this.rewardLoaded = false;
            this.prepareReward(); 
        });

        try {
            console.log("AdMob DEBUG: Attempting to show rewarded video...");
            await AdMob.showRewardVideoAd();
        } catch (e) {
            console.warn("AdMob DEBUG: Ad show failed (user dismissed, skipped, or inventory issue). Unblocking user.", e);
            
            // Critical Fallback Logic: Unblock the user on show failure.
            onReward(); 
            this.rewardLoaded = false;
            this.prepareReward(); 
            handler.remove(); 
        }
    }
}

const adManager = new AdManager();

// --- Sound Manager Class ---
class SoundManager {
    constructor() {
        this.bgm = new Audio('/audio/bgm_loop.mp3');
        this.bgm.loop = true;
        this.bgm.volume = 0.4;
        
        this.sfx = {
            hit: new Audio('/audio/sfx_hit.mpwav'),
            collect: new Audio('/audio/sfx_collect.mpwav'),
            levelUp: new Audio('/audio/sfx_level_up.mpwav'),
            gameOver: new Audio('/audio/sfx_game_over.mpwav'),
            successScreen: new Audio('/audio/sfx_success_screen.mpwav')
        };
        this.sfx.hit.volume = 0.6;
        this.sfx.collect.volume = 0.8;
    }

    playBGM() { this.bgm.play().catch(e => {}); }
    stopBGM() { this.bgm.pause(); this.bgm.currentTime = 0; }
    playSFX(key) {
        const audio = this.sfx[key];
        if (audio) {
            audio.currentTime = 0; 
            audio.play().catch(e => {});
        }
    }
}

const soundManager = new SoundManager();

// --- Firebase Init ---
async function initializeFirebase() {
    try {
        if (Object.keys(firebaseConfig).length === 0) return;
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);
        else await signInAnonymously(auth);

        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                highScoresRef = doc(db, "artifacts", appId, "users", userId, "gameData", "cashRun");
                firestoreReady = true;
                loadHighScore();
            }
        });
    } catch (error) {
        console.error("Firebase init error", error);
    }
}

async function loadHighScore() {
    if (!firestoreReady) return;
    try {
        const docSnap = await getDoc(highScoresRef);
        if (docSnap.exists()) levelManager.load(docSnap.data());
    } catch (e) {}
}

async function saveHighScore() {
    if (!firestoreReady) return;
    try {
        await setDoc(highScoresRef, levelManager.getSaveData(), { merge: true });
    } catch (e) {}
}

// --- Game Variables ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('scoreDisplay');
const levelDisplay = document.getElementById('levelDisplay');
const levelProgressBar = document.getElementById('levelProgressBar');

const gameContainer = document.querySelector('.game-container');
const headerElement = document.querySelector('.header');
const tapToPlayOverlay = document.getElementById('tapToPlayOverlay');

const gameOverModal = document.getElementById('gameOverModal');
const levelUpModal = document.getElementById('levelUpModal');
const adTimerModal = document.getElementById('adTimerModal'); 
const levelUpNotification = document.getElementById('levelUpNotification');

const levelUpRunScore = document.getElementById('levelUpRunScore');
const levelUpTotalNetWorth = document.getElementById('levelUpTotalNetWorth');
const modalTotalNetWorth = document.getElementById('modalTotalNetWorth');

const adTimerButton = document.getElementById('adTimerButton'); 
const timerProgress = document.getElementById('timerProgress'); 
const timerCountdownDisplay = document.getElementById('timerCountdownDisplay'); 

const newGameButton = document.getElementById('newGameButton');
const nextLevelButton = document.getElementById('nextLevelButton');

const modalContents = document.querySelectorAll('.modal-content');
const levelUpTitle = document.getElementById('levelUpTitle');
const gameOverTitle = document.getElementById('gameOverTitle');
const scoreElements = document.querySelectorAll('.score-val, .text-2xl, .text-3xl');

let GAME_WIDTH = 400;
let GAME_HEIGHT = 600;
let BLOCK_SIZE = 80;
let NUM_COLS = 5;
let LANE_WIDTH = 80;
const INITIAL_SPEED = 3; 
let SNAKE_Y_POSITION = 300; 

let snakeLength = 5;
let snakeX = 200;
let snakeRadius = 25; 
let SNAKE_SEGMENT_SPACING = 30; 
let snakeTargetX = snakeX;
let snakePath = [];

// Game states: 'IDLE', 'RUNNING', 'COLLIDING', 'LEVEL_UP', 'AD_PAUSE', 'GAMEOVER'
let gameState = 'IDLE'; 
let score = 0; 
let levelManager;
let gameSpeed = INITIAL_SPEED;

let currentTheme = themes[0];

let blocks = [];
let boosts = [];
let particles = [];
let finishLine = null;
let laneLines = [];
let checkpoint = null;
let nextCheckpointIndex = 0;
const CHECKPOINT_FRACTIONS = [0.25, 0.5, 0.75];
let encounterState = { needsRecovery: false };

let collidingBlock = null;
let collisionTimer = 0;
const COLLISION_TICK_RATE = 5; 

// NEW: Ad Timer Variables
const REVIVE_TIME = 5; // 5 seconds
let reviveTimer = REVIVE_TIME;
let reviveTimerInterval = null;
const REVIVE_BILLS = 5; // Bills granted on revive

const expenseTypes = {
    'vacation': { icon: '✈️', animType: 'fly' },
    'outing': { icon: '🏖️', animType: 'fly' },
    'coffee': { icon: '☕', animType: 'float' },
    'shopping': { icon: '🛍️', animType: 'wobble' },
    'gaming': { icon: '🎮', animType: 'shake' },
    'snickers': { icon: '👟', animType: 'jump' },
    'new_tech': { icon: '💻', animType: 'jump' },
    'bills': { icon: '🧾', animType: 'jump' },
    'donut': { icon: '🍰', animType: 'pop' },
    'rent': { icon: '🏡', animType: 'pop' },
    'restaurant': { icon: '🍽️', animType: 'pop' },
    'fast_food': { icon: '🍔', animType: 'pop' },
    'movie': { icon: '🍿', animType: 'pop' }
};

function randomInt(min, max, random = Math.random) {
    return Math.floor(random() * (max - min + 1)) + min;
}

function getBillValue(economy, band, random = Math.random, maxValue = Infinity) {
    const range = economy[band];
    return randomInt(range.min, Math.max(range.min, Math.min(range.max, maxValue)), random);
}

function getWeightedBillValue(economy, random = Math.random) {
    const roll = random();

    if (roll < 0.3) return getBillValue(economy, 'safe', random);
    if (roll < 0.75) return getBillValue(economy, 'risky', random);
    return getBillValue(economy, 'dangerous', random);
}

function getBlockColor(value, min, max) {
    const range = max - min;
    const normalized = (value - min) / (range || 1); 
    const palette = currentTheme.blockColors;
    if (normalized < 0.25) return palette[0]; 
    if (normalized < 0.50) return palette[1]; 
    if (normalized < 0.75) return palette[2]; 
    return palette[3];                        
}

let lastTime = 0;
let targetSpawnInterval; 
let timeSinceLastSpawn = 0; 
let touchStartX = 0;
let isDragging = false;

// --- ASSET LOADING ---
let assetsLoaded = 0;
const totalAssets = 3; 

function checkAssetsLoaded() {
    assetsLoaded++;
    if (assetsLoaded === totalAssets) {
        initGame();
        levelManager = new LevelManager();
        resetGame(true); 
        draw();
        initializeFirebase();
    }
}

function handleAssetError(e) {
    console.warn("Asset failed:", e.target.src);
    checkAssetsLoaded(); 
}

const walletSvg = new Image();
walletSvg.onload = checkAssetsLoaded;
walletSvg.onerror = handleAssetError;
walletSvg.src = '/wallet.svg'; 

const billStackSvg = new Image();
billStackSvg.onload = checkAssetsLoaded;
billStackSvg.onerror = handleAssetError;
billStackSvg.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48ZyBmaWxsPSJub25lIj48cmVjdCB4PSIyMCIgeT0iMzAiIHdpZHRoPSI2MCIgaGVpZ2h0PSI0MCIgZmlsbD0iIzg1YmI2NSIgc3Ryb2tlPSIjMjI4YjIyIiBzdHJva2Utd2lkdGg9IjIiLz48cGF0aCBkPSJNMjAgNDBMODAgNDAiIHN0cm9rZT0iIzIyOGIyMiIgc3Ryb2tlLXdpZHRoPSIyIi8+PHBhdGggZD0iTTIwIDYwTDgwIDYwIiBzdHJva2U9IiMyMjhiMjIiIHN0cm9rZS13aWR0aD0iMiIvPjxyZWN0IHg9IjQwIiB5PSIzMCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjZmZkNzAwIiBvcGFjaXR5PSIwLjUiLz48dGV4dCB4PSI1MCIgeT0iNTYiIGZvbnQtc2l6ZT0iMjQiIGZvbnQtZmFtaWx5PSJhcmlhbCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiMwNjRlM2IiPiQ8L3RleHQ+PC9nPjwvc3ZnPg==';

const moneyBagSvg = new Image();
moneyBagSvg.onload = checkAssetsLoaded;
moneyBagSvg.onerror = handleAssetError;
moneyBagSvg.src = '/money_bag.svg'; 

function applyTheme(theme) {
    currentTheme = theme;
    
    document.body.style.backgroundColor = theme.bg;
    gameContainer.style.backgroundColor = theme.bg;
    canvas.style.backgroundColor = theme.bg;
    
    headerElement.style.backgroundColor = theme.headerBg;
    headerElement.style.color = theme.text;
    
    scoreDisplay.parentElement.style.color = theme.score;
    scoreDisplay.style.color = theme.score;
    
    modalContents.forEach(modal => {
        modal.style.backgroundColor = theme.headerBg;
        modal.style.color = theme.text;
        modal.style.borderColor = theme.score; 
    });
    
    levelUpTitle.style.color = theme.modalTitleSuccess;
    gameOverTitle.style.color = theme.modalTitleFail;

    scoreElements.forEach(el => {
        el.style.color = theme.score;
    });
}

class Block {
    constructor(x, y, value, type, color) {
        this.x = x;
        this.y = y;
        this.width = BLOCK_SIZE;
        this.height = BLOCK_SIZE / 1.5;
        this.value = value;
        this.color = color; 
        this.type = type;
        this.isDestroyed = false; 
        this.isBought = false;    
        this.animType = expenseTypes[type].animType;
        this.animTimer = 0;
        this.animScale = 1;
        this.animRotation = 0;
        this.animOffsetX = 0;
        this.animOffsetY = 0;
        this.animAlpha = 1.0; 
        this.hitScale = 1.0; 
    }

    draw() {
        if (this.isDestroyed || this.animAlpha <= 0) return;
        const centerX = this.x + this.width / 2;
        const centerY = this.y + this.height / 2;
        const fontSize = Math.floor(BLOCK_SIZE * 0.35);

        ctx.save();
        
        if (!this.isBought) {
            ctx.translate(centerX, centerY);
            ctx.scale(this.hitScale, this.hitScale);
            ctx.translate(-centerX, -centerY);

            ctx.fillStyle = this.hitScale > 1.05 ? '#ffe0e0' : this.color; 
            ctx.beginPath();
            ctx.roundRect(this.x, this.y, this.width, this.height, 8);
            ctx.fill();
            
            ctx.font = `700 ${fontSize}px Jost`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            ctx.fillStyle = '#161b22'; 
            ctx.fillText(expenseTypes[this.type].icon, this.x + this.width * 0.25, centerY);
            ctx.fillText(this.value, this.x + this.width * 0.7, centerY);
        } else {
            // This is the animating emoji, which we want on top of the snake body
            ctx.globalAlpha = this.animAlpha;
            ctx.translate(centerX + this.animOffsetX, centerY + this.animOffsetY);
            ctx.rotate(this.animRotation);
            ctx.scale(this.animScale, this.animScale);
            
            ctx.font = `700 ${fontSize * 1.5}px Jost`; 
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(expenseTypes[this.type].icon, 0, 0);
        }
        ctx.restore();
    }
    
    update(deltaTime) {
        this.y += gameSpeed * deltaTime;

        if(this.hitScale > 1.0) {
            this.hitScale -= deltaTime * 0.1;
            if(this.hitScale < 1.0) this.hitScale = 1.0;
        }

        if (this.isBought) {
            this.animTimer += deltaTime * 0.1; 

            if (this.animType === 'fly') {
                this.animOffsetX = Math.sin(this.animTimer * 0.5) * 60;
                this.animOffsetY = Math.cos(this.animTimer * 0.5) * 60 - (this.animTimer * 20);
                this.animRotation = Math.sin(this.animTimer * 0.5) * 0.5;
                this.animScale = Math.max(0, 1 - (this.animTimer * 0.01));
            } else if (this.animType === 'float') {
                this.animOffsetY -= deltaTime * 1.5;
                this.animOffsetX = Math.sin(this.animTimer * 2) * 5; 
                this.animScale = 1 + (this.animTimer * 0.01);
                this.animAlpha = Math.max(0, 1 - (this.animTimer * 0.02));
            } else if (this.animType === 'wobble') {
                this.animRotation = Math.sin(this.animTimer * 5) * 0.3;
                this.animScale = 1.2; 
            } else if (this.animType === 'shake') {
                this.animOffsetX = Math.sin(this.animTimer * 30) * 4;
                this.animScale = 1.2;
            } else if (this.animType === 'pop') {
                const wobble = Math.sin(this.animTimer * 0.8) * (1 / (this.animTimer * 0.1 + 1));
                this.animScale = 1.2 + wobble;
            } else if (this.animType === 'jump') {
                this.animOffsetY = Math.abs(Math.sin(this.animTimer * 5)) * -20;
                this.animScale = 1.1;
            }
        }
    }
}

class Boost {
    constructor(x, y, value) {
        this.x = x;
        this.y = y;
        this.value = value;
        this.radius = snakeRadius * 0.8;
        this.isCollected = false;
    }
    update(deltaTime) { this.y += gameSpeed * deltaTime; }
    
    draw() {
        if (this.isCollected) return;
        const size = this.radius * 1.6; 
        
        ctx.save();
        
        const glowRadius = this.radius * 1.5; 
        const gradient = ctx.createRadialGradient(
            this.x, this.y, this.radius * 0.2, 
            this.x, this.y, glowRadius 
        );
        gradient.addColorStop(0, "rgba(255, 215, 0, 0.3)"); 
        gradient.addColorStop(1, "rgba(255, 215, 0, 0)"); 
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.filter = currentTheme.svgFilter;
        ctx.drawImage(moneyBagSvg, this.x - size/2, this.y - size/2, size, size);
        ctx.filter = 'none';
        
        ctx.fillStyle = '#ffffff'; 
        const fontSize = Math.floor(snakeRadius * 0.5);
        ctx.font = `700 ${fontSize}px Jost`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.value, this.x, this.y + size/2 + 10);
        
        ctx.restore();
    }
}

class LaneLine {
    constructor(x, y, height) {
        this.x = x;
        this.y = y;
        this.height = height;
        this.width = 4; 
    }
    update(deltaTime) {
        this.y += gameSpeed * deltaTime;
    }
    draw() {
        ctx.fillStyle = currentTheme.text; 
        ctx.globalAlpha = 0.4; 
        ctx.fillRect(this.x - this.width / 2, this.y, this.width, this.height);
        ctx.globalAlpha = 1.0;
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 8; 
        this.vy = (Math.random() - 0.5) * 8;
        this.life = Math.random() * 20 + 10;
        this.size = Math.random() * 4 + 2;
        this.color = color || `rgba(255, 223, 0, ${Math.random() * 0.5 + 0.5})`;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life--;
    }
    draw() {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);
    }
}

class FinishLine {
    constructor() {
        this.y = -BLOCK_SIZE; 
        this.height = 10;
        this.isPassed = false;
    }
    update(deltaTime) { this.y += gameSpeed * deltaTime; }
    draw() {
        ctx.fillStyle = '#4ADE80';
        ctx.fillRect(0, this.y, GAME_WIDTH, this.height);
    }
}

function getRandomSpawnInterval(profile = getChallengeProfile(levelManager.currentLevel)) {
    return randomInt(profile.spawnInterval.min, profile.spawnInterval.max);
}

// --- INIT LOGIC (Dynamic Scaling) ---
function initGame() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    GAME_WIDTH = canvas.width;
    GAME_HEIGHT = canvas.height;
    
    const targetBlockSize = 80; 
    const rawCols = GAME_WIDTH / targetBlockSize;
    
    NUM_COLS = Math.max(3, 2 * Math.round((rawCols - 1) / 2) + 1);
    BLOCK_SIZE = GAME_WIDTH / NUM_COLS;
    LANE_WIDTH = BLOCK_SIZE; 
    
    snakeRadius = BLOCK_SIZE * 0.35; 
    
    // ** REDUCED SPACING TO 0.6 **
    SNAKE_SEGMENT_SPACING = snakeRadius * 0.7; 
    
    SNAKE_Y_POSITION = GAME_HEIGHT * 0.6; 

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

function resetGame(fullReset = false) {
    adManager.hideBanner();
    soundManager.stopBGM(); 

    if (!levelManager) levelManager = new LevelManager();
    
    gameOverModal.style.display = 'none';
    levelUpModal.style.display = 'none';
    adTimerModal.style.display = 'none'; // Ensure ad timer modal is hidden

    if (fullReset) {
        const randomTheme = themes[Math.floor(Math.random() * themes.length)];
        applyTheme(randomTheme);

        levelManager.resetRun(); 
        gameState = 'IDLE';
        tapToPlayOverlay.style.display = 'block'; 
    } else {
        gameState = 'RUNNING';
        tapToPlayOverlay.style.display = 'none';
        soundManager.playBGM(); 
    }

    score = 0;
    snakeLength = levelManager.baseLength;
    
    snakeX = GAME_WIDTH / 2;
    snakeTargetX = snakeX;
    
    gameSpeed = getChallengeProfile(levelManager.currentLevel).speed.initial;
    blocks = [];
    boosts = [];
    particles = [];
    finishLine = null;
    snakePath = [];
    collidingBlock = null;
    laneLines = [];
    checkpoint = null;
    nextCheckpointIndex = 0;
    encounterState = { needsRecovery: false };
    
    for(let i = 0; i < 300; i+=5) {
        snakePath.push({ x: snakeX, y: SNAKE_Y_POSITION + i });
    }
    
    timeSinceLastSpawn = 0; 
    targetSpawnInterval = getRandomSpawnInterval(); 
    
    scoreDisplay.textContent = levelManager.globalNetWorth;
    levelDisplay.textContent = levelManager.currentLevel;
    levelProgressBar.style.width = '0%';
    
    levelUpNotification.classList.remove('animate-level-text');
    levelUpNotification.textContent = 'LEVEL UP!';

    lastTime = performance.now();
    
    if (fullReset) {
        draw();
    } else {
        requestAnimationFrame(gameLoop);
    }
}

function startGame() {
    if (assetsLoaded < totalAssets) return;
    if (gameState === 'IDLE') {
        gameState = 'RUNNING';
        tapToPlayOverlay.style.display = 'none';
        lastTime = performance.now();
        soundManager.playBGM(); 
        requestAnimationFrame(gameLoop);
    }
}

// --- NEW: Timer Logic ---
function updateReviveTimer(deltaTime) {
    if (gameState !== 'AD_PAUSE') {
        return;
    }

    reviveTimer -= deltaTime / 60; // DeltaTime is based on 60 FPS update scale

    const percentage = Math.min(100, Math.max(0, (reviveTimer / REVIVE_TIME) * 100));

    // Update the circular progress bar using conic-gradient
    // We reverse the gradient so it counts down clockwise (from 360 to 0)
    timerProgress.style.background = `conic-gradient(
        transparent ${100 - percentage}%,
        #10b981 ${100 - percentage}%
    )`;

    // The countdown display is hidden by CSS, but we keep updating it just in case:
    timerCountdownDisplay.textContent = Math.max(0, Math.ceil(reviveTimer)); 

    if (reviveTimer <= 0) {
        // Time ran out, proceed to final game over screen
        adTimerModal.style.display = 'none';
        finalGameOver();
    }
}

function startReviveTimer() {
    gameState = 'AD_PAUSE';
    reviveTimer = REVIVE_TIME;
    adTimerModal.style.display = 'flex';
    adManager.hideBanner();
    
    timerCountdownDisplay.textContent = REVIVE_TIME;

    // Log the ad status immediately when the timer starts
    console.log(`AdMob DEBUG: Starting revive timer. Ad is currently loaded: ${adManager.rewardLoaded}`);
}

function rebuildSnakePath() {
    snakeX = GAME_WIDTH / 2;
    snakeTargetX = snakeX;
    snakePath = [];

    for (let i = 0; i < 300; i += 5) {
        snakePath.push({ x: snakeX, y: SNAKE_Y_POSITION + i });
    }
}

function showCheckpointNotification() {
    levelUpNotification.textContent = 'CHECKPOINT!';
    levelUpNotification.classList.remove('animate-level-text');
    void levelUpNotification.offsetWidth;
    levelUpNotification.classList.add('animate-level-text');
}

function saveCheckpoint() {
    checkpoint = createCheckpointSnapshot({
        distance: levelManager.runDistance,
        // Recovery should help, without restoring the player's full strength.
        wallet: Math.max(2, Math.floor(snakeLength * 0.65)),
        score,
        speed: gameSpeed
    });
    showCheckpointNotification();
}

function restoreCheckpoint() {
    if (!checkpoint) return false;

    levelManager.runDistance = checkpoint.distance;
    score = checkpoint.score;
    levelManager.runScore = score;
    snakeLength = checkpoint.wallet;
    gameSpeed = checkpoint.speed;
    blocks = [];
    boosts = [];
    particles = [];
    laneLines = [];
    finishLine = null;
    collidingBlock = null;
    collisionTimer = 0;
    encounterState = { needsRecovery: true };
    timeSinceLastSpawn = 0;
    targetSpawnInterval = getRandomSpawnInterval();
    rebuildSnakePath();
    levelProgressBar.style.width = `${Math.min(
        (levelManager.runDistance / levelManager.distanceThreshold) * 100,
        100
    )}%`;
    return true;
}

function reviveGame() {
    // Clear timer and hide modal
    adTimerModal.style.display = 'none';

    // A rewarded ad returns the player to their latest checkpoint. Before the
    // first checkpoint, retain the original small in-place revive.
    if (!restoreCheckpoint()) {
        snakeLength = REVIVE_BILLS;
        if (collidingBlock) {
            collidingBlock.isDestroyed = true;
            collidingBlock = null;
        }
    }
    
    gameState = 'RUNNING';
    lastTime = performance.now();
    soundManager.playBGM(); 
    requestAnimationFrame(gameLoop);
}

async function finalGameOver() {
    // Show the regular game over modal
    gameState = 'GAMEOVER';
    await adManager.showInterstitial();
    adManager.showBanner();
    levelManager.saveToLocalStorage(); 
    modalTotalNetWorth.textContent = levelManager.globalNetWorth;
    gameOverModal.style.display = 'flex';
    soundManager.playSFX('gameOver'); 
}


function spawnObjects() {
    if (finishLine) return; 

    if (levelManager.runDistance > levelManager.distanceThreshold - 250) {
        return; 
    }

    const profile = getChallengeProfile(levelManager.currentLevel);
    const economy = getLiveEconomy(profile, snakeLength);
    const shouldRecover = encounterState.needsRecovery || economy.needsRecovery;
    const isWall = !shouldRecover && Math.random() < profile.wallChance;
    const minimumBill = economy.safe.min;
    const maximumBill = economy.dangerous.max;
    let newBlocks = [];

    if (isWall) {
        const lanes = Array.from({ length: NUM_COLS }, (_, i) => i);
        const lowIndices = [];
        while(lowIndices.length < 2) {
            const idx = Math.floor(Math.random() * NUM_COLS);
            if(!lowIndices.includes(idx)) lowIndices.push(idx);
        }

        lanes.forEach(laneIndex => {
            const typeKeys = Object.keys(expenseTypes);
            const randomTypeKey = typeKeys[Math.floor(Math.random() * typeKeys.length)];
            
            let blockValue;
            if (lowIndices.includes(laneIndex)) {
                // Walls always provide two bills that cost no more than 65%
                // of the wallet size at the moment the wall is created.
                const affordableMax = Math.max(
                    economy.safe.min,
                    Math.floor(snakeLength * 0.65)
                );
                blockValue = getBillValue(economy, 'safe', Math.random, affordableMax);
            } else {
                blockValue = getWeightedBillValue(economy);
            }

            const color = getBlockColor(blockValue, minimumBill, maximumBill);
            const newBlock = new Block(laneIndex * LANE_WIDTH, -BLOCK_SIZE, blockValue, randomTypeKey, color);
            blocks.push(newBlock);
            newBlocks.push(newBlock);
        });

    } else {
        const numBlocks = Math.floor(Math.random() * (NUM_COLS / 2)) + 1; 
        const lanes = Array.from({ length: NUM_COLS }, (_, i) => i);
        const selectedLanes = [];
        for (let i = 0; i < numBlocks; i++) {
            if (lanes.length === 0) break;
            const randomIndex = Math.floor(Math.random() * lanes.length);
            selectedLanes.push(lanes.splice(randomIndex, 1)[0]);
        }

        selectedLanes.forEach(laneIndex => {
            const typeKeys = Object.keys(expenseTypes);
            const randomTypeKey = typeKeys[Math.floor(Math.random() * typeKeys.length)];
            
            const blockValue = getWeightedBillValue(economy);
            const color = getBlockColor(blockValue, minimumBill, maximumBill);
            
            const newBlock = new Block(laneIndex * LANE_WIDTH, -BLOCK_SIZE, blockValue, randomTypeKey, color);
            blocks.push(newBlock);
            newBlocks.push(newBlock);
        });
    }

    newBlocks.forEach(block => {
        if (Math.random() < 0.3) {
            const side = Math.random() < 0.5 ? 'left' : 'right';
            let lineX;
            if (side === 'left') {
                lineX = block.x; 
            } else {
                lineX = block.x + block.width; 
            }

            if (lineX > 5 && lineX < GAME_WIDTH - 5) {
                const lengthMultiplier = Math.random() < 0.5 ? 1 : 2;
                const lineHeight = BLOCK_SIZE * lengthMultiplier;

                const position = Math.random() < 0.5 ? 'before' : 'after';
                let lineY;

                if (position === 'before') {
                    lineY = block.y + block.height;
                } else {
                    lineY = block.y - lineHeight;
                }

                laneLines.push(new LaneLine(lineX, lineY, lineHeight));
            }
        }
    });

    const bagChance = shouldRecover ? 1 : profile.bag.chance;
    if (Math.random() < bagChance) {
        const laneIndex = Math.floor(Math.random() * NUM_COLS);
        const boostValue = randomInt(economy.bag.min, economy.bag.max);
        boosts.push(new Boost(laneIndex * LANE_WIDTH + LANE_WIDTH / 2, -BLOCK_SIZE * 1.5, boostValue));
    }

    // A wall is always followed by a non-wall encounter with a recovery bag.
    encounterState.needsRecovery = isWall;
}

function update(deltaTime) {
    if (gameState === 'IDLE' || gameState === 'GAMEOVER' || gameState === 'LEVEL_UP' || gameState === 'AD_PAUSE') return;

    const moveDelta = snakeTargetX - snakeX;
    let nextX = snakeX + moveDelta * 0.15; 

    
    // 1. Lane Lines (Visual guides)
    laneLines.forEach(line => {
         if (SNAKE_Y_POSITION >= line.y && SNAKE_Y_POSITION <= line.y + line.height) {
             if (snakeX <= line.x - snakeRadius && nextX > line.x - snakeRadius) nextX = line.x - snakeRadius; 
             else if (snakeX >= line.x + snakeRadius && nextX < line.x + snakeRadius) nextX = line.x + snakeRadius; 
         }
    });

    // 2. Physical Block Walls (Prevent Overlap)
    blocks.forEach(block => {
        if (block.isDestroyed || block.isBought) return;
        
        // We only check for horizontal containment if the snake head's Y position is vertically aligned with the block.
        if (SNAKE_Y_POSITION + snakeRadius > block.y && SNAKE_Y_POSITION - snakeRadius < block.y + block.height) {
            
            // If snake is to the left, don't move right into it
            if (snakeX + snakeRadius <= block.x && nextX + snakeRadius > block.x) {
                nextX = block.x - snakeRadius;
            }
            // If snake is to the right, don't move left into it
            else if (snakeX - snakeRadius >= block.x + block.width && nextX - snakeRadius < block.x + block.width) {
                nextX = block.x + block.width + snakeRadius;
            }
        }
    });

    const headY = SNAKE_Y_POSITION;
    let minX = snakeRadius; 
    let maxX = GAME_WIDTH - snakeRadius;

    snakeX = Math.max(minX, Math.min(maxX, nextX));

    if (snakePath.length > 0) {
        snakePath[0].x = snakeX; 
    } else {
        snakePath.unshift({ x: snakeX, y: SNAKE_Y_POSITION });
    }

    if (gameState === 'COLLIDING' && collidingBlock) {
        const head = {x: snakeX, y: SNAKE_Y_POSITION};
        
        // If we slide out of the block's X range while colliding, stop colliding.
        if (head.x - snakeRadius > collidingBlock.x + collidingBlock.width || head.x + snakeRadius < collidingBlock.x) {
            gameState = 'RUNNING';
            collidingBlock = null;
            return;
        }

        let currentTickRate = COLLISION_TICK_RATE; 
        if (collidingBlock.value > 30) {
            currentTickRate = 2; 
        } else if (collidingBlock.value > 10) {
            currentTickRate = 5; 
        }

        collisionTimer++;
        if (collisionTimer >= currentTickRate) {
            collisionTimer = 0;
            
            soundManager.playSFX('hit');
            triggerHaptic('light'); 

            collidingBlock.value--;
            collidingBlock.hitScale = 1.15; 
            
            createBlockHitEffect(snakeX, SNAKE_Y_POSITION - snakeRadius, collidingBlock.color);

            snakeLength--;
            
            if (snakeLength <= 0) {
                snakeLength = 0; 
                endGame(); // Calls startReviveTimer
            } else if (collidingBlock.value <= 0) {
                collidingBlock.isBought = true;
                collidingBlock.animTimer = 0; 
                gameState = 'RUNNING';
                collidingBlock = null;
            }
        }
        
        particles.forEach(p => p.update());
        particles = particles.filter(p => p.life > 0);
        return; 
    }

    score += Math.floor(deltaTime * gameSpeed * 0.1);
    levelManager.runScore = score;
    const speedProfile = getChallengeProfile(levelManager.currentLevel).speed;
    gameSpeed = Math.min(
        speedProfile.max,
        gameSpeed + deltaTime * speedProfile.acceleration
    );
    
    scoreDisplay.textContent = levelManager.globalNetWorth + score;

    const progress = (levelManager.runDistance / levelManager.distanceThreshold) * 100;
    if (levelProgressBar) {
        levelProgressBar.style.width = `${Math.min(progress, 100)}%`;
    }

    if (!finishLine && levelManager.runDistance >= levelManager.distanceThreshold) {
        finishLine = new FinishLine();
    }

    if (finishLine) {
        finishLine.update(deltaTime);
        if (!finishLine.isPassed && snakePath[0].y < finishLine.y + finishLine.height) {
            if (finishLine.y > SNAKE_Y_POSITION) {
                levelUpSequence();
                soundManager.playSFX('levelUp'); 
                finishLine.isPassed = true;
            }
        }
    }

    const distanceTraveled = gameSpeed * deltaTime;
    levelManager.updateDistance(distanceTraveled);

    if (
        nextCheckpointIndex < CHECKPOINT_FRACTIONS.length &&
        levelManager.runDistance >=
            levelManager.distanceThreshold * CHECKPOINT_FRACTIONS[nextCheckpointIndex]
    ) {
        saveCheckpoint();
        nextCheckpointIndex++;
    }

    for(let i = 0; i < snakePath.length; i++) {
        snakePath[i].y += gameSpeed * deltaTime;
    }
    snakePath.unshift({ x: snakeX, y: SNAKE_Y_POSITION });

    const maxPathY = SNAKE_Y_POSITION + (snakeLength * SNAKE_SEGMENT_SPACING) + 100;
    let cutIndex = -1;
    for(let i=0; i<snakePath.length; i++) {
        if(snakePath[i].y > maxPathY) {
            cutIndex = i;
            break;
        }
    }
    if(cutIndex !== -1) snakePath.splice(cutIndex);

    blocks.forEach(block => block.update(deltaTime));
    boosts.forEach(boost => boost.update(deltaTime));
    laneLines.forEach(line => line.update(deltaTime));
    
    handleCollisions();
    
    particles.forEach(p => p.update());
    particles = particles.filter(p => p.life > 0);

    timeSinceLastSpawn += deltaTime;
    if (timeSinceLastSpawn > targetSpawnInterval) {
        spawnObjects();
        timeSinceLastSpawn = 0; 
        targetSpawnInterval = getRandomSpawnInterval();
    }
    blocks = blocks.filter(block => block.y < GAME_HEIGHT);
    boosts = boosts.filter(boost => boost.y < GAME_HEIGHT && !boost.isCollected);
    laneLines = laneLines.filter(line => line.y < GAME_HEIGHT);
}

function createSparkleEffect(x, y, count) {
    for (let i = 0; i < count; i++) {
        const color = `rgba(255, 223, 0, ${Math.random() * 0.5 + 0.5})`;
        particles.push(new Particle(x, y, color));
    }
}

function createBlockHitEffect(x, y, color) {
    for (let i = 0; i < 15; i++) {
        particles.push(new Particle(x, y, color));
    }
}

async function triggerHaptic(style = 'light') {
    try {
        if (style === 'medium') {
            await Haptics.impact({ style: ImpactStyle.Medium });
        } else {
            await Haptics.impact({ style: ImpactStyle.Light });
        }
    } catch (e) {}
}

function handleCollisions() {
    const head = snakePath[0] || {x: snakeX, y: SNAKE_Y_POSITION};
    let highestPriorityBlock = null;
    let minBlockBottomY = Infinity; 

    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        if (block.isDestroyed || block.isBought) continue;

        // 1. Horizontal Check (Must be aligned over the block)
        const snakeLeft = head.x - snakeRadius;
        const snakeRight = head.x + snakeRadius;
        const blockLeft = block.x;
        const blockRight = block.x + block.width;

        if (snakeRight <= blockLeft || snakeLeft >= blockRight) {
            continue; 
        }

        // 2. Vertical Proximity Check (Must be engaging the block)
        const blockBottomY = block.y + block.height;
        const headTopY = head.y - snakeRadius;
        const headBottomY = head.y + snakeRadius;
        
        // Collision triggers if the block's bottom edge is below the snake's top point
        // AND above a small vertical buffer near the center of the snake head.
        if (blockBottomY > headTopY && blockBottomY < headBottomY - snakeRadius * 0.5) {
            
            // Priority Check: Find the block whose bottom is highest (lowest Y value)
            if (blockBottomY < minBlockBottomY) {
                minBlockBottomY = blockBottomY;
                highestPriorityBlock = block;
            }
        }
    }
    
    // --- ACTIVATE COLLISION WITH ONLY THE HIGHEST PRIORITY BLOCK ---
    if (highestPriorityBlock) {
        gameState = 'COLLIDING';
        collidingBlock = highestPriorityBlock;
        return; 
    }

    // --- BOOST COLLISION ---
    for (let i = boosts.length - 1; i >= 0; i--) {
        const boost = boosts[i];
        if (Math.sqrt((head.x - boost.x) ** 2 + (head.y - boost.y) ** 2) < snakeRadius + boost.radius + 5) {
            snakeLength += boost.value;
            boost.isCollected = true;
            createSparkleEffect(boost.x, boost.y, 15);
            boosts.splice(i, 1);
            
            soundManager.playSFX('collect');
            triggerHaptic('medium'); 
        }
    }
}

function getSnakeTailPosition() {
    if (snakePath.length < 2) {
        return snakePath[0] || { x: snakeX, y: SNAKE_Y_POSITION };
    }
    let accumulatedDist = 0;
    const targetDist = (snakeLength - 1) * SNAKE_SEGMENT_SPACING;
    for (let i = 0; i < snakePath.length - 1; i++) {
        const p1 = snakePath[i];
        const p2 = snakePath[i+1];
        const segmentLen = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (accumulatedDist + segmentLen >= targetDist) {
            const remainingNeeded = targetDist - accumulatedDist;
            const ratio = remainingNeeded / segmentLen;
            return { x: p1.x + (p2.x - p1.x) * ratio, y: p1.y + (p2.y - p1.y) * ratio };
        }
        accumulatedDist += segmentLen;
    }
    return snakePath[snakePath.length - 1];
}

function draw() {
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Draw background elements first
    boosts.forEach(boost => boost.draw());
    laneLines.forEach(line => line.draw());
    if (finishLine) finishLine.draw();
    particles.forEach(p => p.draw());

    if (snakePath.length < 2) return;

    // --- 1. DRAW BODY (BILLS) ---
    // This draws the snake's body bills.
    let accumulatedDist = 0;
    let ballsDrawn = 1; 
    const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);

    for (let i = 0; i < snakePath.length - 1 && ballsDrawn < snakeLength; i++) {
        const p1 = snakePath[i];
        const p2 = snakePath[i+1];
        const segmentLen = dist(p1, p2);
        if (accumulatedDist + segmentLen >= SNAKE_SEGMENT_SPACING) {
            const remainingNeeded = SNAKE_SEGMENT_SPACING - accumulatedDist;
            const ratio = remainingNeeded / segmentLen;
            const ballX = p1.x + (p2.x - p1.x) * ratio;
            const ballY = p1.y + (p2.y - p1.y) * ratio;
            
            drawSnakeBall(ballX+3, ballY+10, ballsDrawn); // Draw bill
            
            ballsDrawn++;
            accumulatedDist = segmentLen - remainingNeeded; 
        } else {
            accumulatedDist += segmentLen;
        }
    }
    
    // --- 2. DRAW BLOCKS (INCLUDING ANIMATING EMOJI) ---
    // Drawing them now ensures the animating emoji is above the bills.
    blocks.forEach(block => block.draw()); 

    // --- 3. DRAW HEAD (WALLET) LAST ---
    // This puts the wallet on top of both the bills and the blocks.
    drawSnakeBall(snakePath[0].x, snakePath[0].y, 0);
}

function drawSnakeBall(x, y, index) {
    const size = snakeRadius * 2;
    if (index === 0) {
        const walletSize = size * 0.9;
        
        ctx.save();
        
        // 1. FIXED GRADIENT GLOW (White -> Transparent White)
        const glowRadius = snakeRadius * 1.5; 
        const gradient = ctx.createRadialGradient(
            x, y, snakeRadius * 0.3, 
            x, y, glowRadius 
        );
        
        gradient.addColorStop(0, "rgba(255, 255, 255, 0.4)"); 
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)"); 
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // 2. DRAW WALLET IMAGE
        ctx.filter = currentTheme.svgFilter;
        ctx.drawImage(walletSvg, x - walletSize/2, y - walletSize/2, walletSize, walletSize);
        
        ctx.restore();

        // 3. DRAW TEXT
        const fontSize = Math.floor(snakeRadius * 0.7);
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${fontSize}px Jost`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(snakeLength, x - 1, y - walletSize / 2); 
    } else {
        // --- BILLS (BODY) ---
        // REDUCED SIZE: Calculate a specific bill size (e.g., 80% of original)
        const billSize = size * 0.8;

        const alpha = Math.max(0.4, 1 - (index / (snakeLength + 5)));
        ctx.globalAlpha = alpha;
        
        // Use billSize instead of size
        ctx.drawImage(billStackSvg, x - billSize/2, y - billSize/2, billSize, billSize);
        ctx.globalAlpha = 1.0; 
    }
}

function levelUpSequence() {
    soundManager.stopBGM(); 
    soundManager.playSFX('successScreen'); 
    
    gameState = 'LEVEL_UP';
    levelUpNotification.textContent = 'LEVEL UP!';
    levelUpNotification.classList.add('animate-level-text');
    
    adManager.showBanner();

    const visibleWalletMoney = snakeLength;
    const distanceBonus = Math.floor(score / 10); 
    const totalEarnings = visibleWalletMoney + distanceBonus;
    
    const startNetWorth = levelManager.globalNetWorth;

    levelUpRunScore.textContent = totalEarnings;
    levelUpTotalNetWorth.textContent = startNetWorth;
    
    // Ensure button is hidden before animation starts, just in case of race conditions
    nextLevelButton.style.display = 'none'; 

    setTimeout(() => {
        levelUpModal.style.display = 'flex';
        
        let addedToNetWorth = 0;
        let visualNetWorth = startNetWorth;
        const totalSteps = 50; 
        const increment = Math.max(1, Math.floor(totalEarnings / totalSteps));
        
        const countInterval = setInterval(() => {
            if (addedToNetWorth < totalEarnings) {
                const step = Math.min(increment, totalEarnings - addedToNetWorth);
                addedToNetWorth += step;
                visualNetWorth += step;
                
                levelUpTotalNetWorth.textContent = visualNetWorth;
            } else {
                // --- Logic when counting finishes ---
                clearInterval(countInterval);
                
                levelManager.levelComplete(totalEarnings); 
                saveHighScore();
                
                levelUpRunScore.textContent = totalEarnings; 
                levelUpTotalNetWorth.textContent = levelManager.globalNetWorth;
                levelDisplay.textContent = levelManager.currentLevel;
                scoreDisplay.textContent = levelManager.globalNetWorth;

                // Ensure the button is made visible here.
                nextLevelButton.style.display = 'block'; 
            }
        }, 20);
        
    }, 1500);
}

function endGame() {
    // Game over logic starts the timer instead of showing the final screen immediately
    soundManager.stopBGM(); 
    startReviveTimer();
}

function gameLoop(currentTime) {
    if (gameState === 'IDLE' || gameState === 'GAMEOVER') return;
    
    const deltaTime = (currentTime - lastTime) / 1000; 
    lastTime = currentTime;
    
    if (gameState === 'AD_PAUSE') {
        // When paused, we only update the timer but still call draw() to show the game state
        updateReviveTimer(deltaTime * 60); 
    } else {
        // Normal game update
        update(deltaTime * 60); 
    }

    draw();
    requestAnimationFrame(gameLoop);
}

function getRelativeX(event) {
    const rect = canvas.getBoundingClientRect();
    return (event.clientX || event.touches[0].clientX) - rect.left;
}
function handleInputStart(event) {
    if (gameState === 'IDLE') {
        startGame();
    }

    if (gameState !== 'RUNNING' && gameState !== 'COLLIDING') return;
    event.preventDefault(); 
    touchStartX = getRelativeX(event);
    isDragging = true;
}
function handleInputMove(event) {
    if ((gameState !== 'RUNNING' && gameState !== 'COLLIDING') || !isDragging) return;
    event.preventDefault(); 
    const currentX = getRelativeX(event);
    snakeTargetX = Math.min(GAME_WIDTH - snakeRadius, Math.max(snakeRadius, currentX));
}
function handleInputEnd() { isDragging = false; }

// --- EVENT LISTENERS ---

adTimerButton.addEventListener('click', async () => {
    // User clicked to watch the ad. We now rely entirely on showRewarded to handle all states.
    console.log(`AdMob DEBUG: 'Continue' button clicked. Ad Loaded Status before show: ${adManager.rewardLoaded}`);
    // Changed handler to async function so we can use await inside showRewarded logic
    await adManager.showRewarded(reviveGame);
});

// Original buttons

newGameButton.addEventListener('click', () => {
    gameOverModal.style.display = 'none';
    resetGame(true);
});

nextLevelButton.addEventListener('click', async () => {
    // A level transition is a natural pause; show an additional ad every
    // third completed level without interrupting an active run.
    if ((levelManager.currentLevel - 1) % 3 === 0) {
        await adManager.showInterstitial();
    }
    resetGame(false); 
    startGame();
});

canvas.addEventListener('mousedown', handleInputStart);
canvas.addEventListener('mousemove', handleInputMove);
canvas.addEventListener('mouseup', handleInputEnd);
canvas.addEventListener('mouseleave', handleInputEnd);
canvas.addEventListener('touchstart', handleInputStart);
canvas.addEventListener('touchmove', handleInputMove);
canvas.addEventListener('touchend', handleInputEnd);