// Constants for game progression
const INITIAL_LEVEL = 1;
const INITIAL_NET_WORTH = 0;

/**
 * Returns all values used to tune a level. Keeping them together prevents
 * player capacity from growing faster than hazards and rewards.
 */
export function getChallengeProfile(level) {
    const safeLevel = Math.max(1, Math.floor(level));
    const intensity = 1 - Math.exp(-safeLevel / 28);
    // Keep the wallet deliberately lean. Higher levels gain some resilience,
    // but never enough to absorb several expensive bills without planning.
    const startingWallet = Math.round(5 + intensity * 13);
    const lowMax = Math.max(2, Math.floor(startingWallet * (0.42 + intensity * 0.08)));
    const mediumMin = Math.max(lowMax + 1, Math.floor(startingWallet * 0.55));
    const mediumMax = Math.max(mediumMin, Math.floor(startingWallet * (0.85 + intensity * 0.15)));
    const highMin = Math.max(mediumMax + 1, Math.floor(startingWallet * 1.05));
    const highMax = Math.max(highMin, Math.floor(startingWallet * (1.35 + intensity * 0.35)));

    return {
        startingWallet,
        // Early runs need enough encounters for route choices to matter.
        distanceThreshold: Math.round(9450 + safeLevel * 1035 + intensity * 4050),
        billBands: {
            low: { min: 1, max: lowMax },
            medium: { min: mediumMin, max: mediumMax },
            high: { min: highMin, max: highMax }
        },
        economy: {
            safeMaxRatio: 0.5,
            riskyMinRatio: 0.6,
            riskyMaxRatio: 1,
            dangerousMinRatio: 1.1,
            dangerousMaxRatio: 1.8,
            bagMaxRatio: 0.2,
            lowWalletRatio: 0.6,
            blockValueCap: Math.round(18 + safeLevel * 2),
            bagValueCap: Math.min(8, 3 + Math.floor(safeLevel / 18))
        },
        bag: {
            min: 1,
            max: Math.max(2, Math.floor(3 + intensity * 2)),
            chance: 0.32 - intensity * 0.17
        },
        wallChance: 0.18 + intensity * 0.27,
        spawnInterval: {
            min: Math.round(52 - intensity * 18),
            max: Math.round(78 - intensity * 24)
        },
        speed: {
            initial: 3 + intensity * 4,
            max: 5.5 + intensity * 6,
            acceleration: 0.0002 + intensity * 0.00035
        }
    };
}

/**
 * Converts a player's live wallet into fair-but-threatening value bands.
 * Level caps prevent values from becoming unreadable, while ratios keep each
 * encounter meaningful if the player has grown or shrunk during the run.
 */
export function getLiveEconomy(profile, wallet) {
    const currentWallet = Math.max(1, Math.floor(wallet));
    const cap = Math.max(1, profile.economy.blockValueCap);
    const safeMax = Math.min(cap, Math.max(1, Math.floor(currentWallet * profile.economy.safeMaxRatio)));
    const riskyMin = Math.min(cap, Math.max(safeMax + 1, Math.ceil(currentWallet * profile.economy.riskyMinRatio)));
    const riskyMax = Math.min(cap, Math.max(riskyMin, Math.floor(currentWallet * profile.economy.riskyMaxRatio)));
    const dangerousMin = Math.min(cap, Math.max(riskyMax + 1, Math.ceil(currentWallet * profile.economy.dangerousMinRatio)));
    const dangerousMax = Math.min(cap, Math.max(dangerousMin, Math.floor(currentWallet * profile.economy.dangerousMaxRatio)));
    const bagMax = Math.min(
        profile.economy.bagValueCap,
        Math.max(1, Math.floor(riskyMax * profile.economy.bagMaxRatio))
    );

    return {
        safe: { min: 1, max: safeMax },
        risky: { min: riskyMin, max: riskyMax },
        dangerous: { min: dangerousMin, max: dangerousMax },
        bag: { min: 1, max: bagMax },
        needsRecovery: currentWallet <= Math.max(2, Math.floor(profile.startingWallet * profile.economy.lowWalletRatio))
    };
}

export function createCheckpointSnapshot({ distance, wallet, score, speed }) {
    return {
        distance: Math.max(0, distance),
        wallet: Math.max(1, Math.floor(wallet)),
        score: Math.max(0, Math.floor(score)),
        speed: Math.max(0, speed)
    };
}

/**
 * Calculates the required distance to travel to complete the given level.
 * @param {number} level - The current level number (N).
 * @returns {number} The distance threshold in pixels.
 */
function calculateLevelThreshold(level) {
    return getChallengeProfile(level).distanceThreshold;
}

/**
 * Calculates the starting snake length for the given level.
 * @param {number} level - The current level number (N).
 * @returns {number} The starting length of the snake/bills.
 */
function calculateBaseLength(level) {
    return getChallengeProfile(level).startingWallet;
}

/**
 * The primary object for managing the global game state and level progression.
 */
class LevelManager {
    constructor() {
        // Global persistent state, loaded/saved via Firebase/LocalStorage
        this.globalNetWorth = INITIAL_NET_WORTH;
        this.currentLevel = INITIAL_LEVEL;
        
        // Try loading from LocalStorage immediately
        this.loadFromLocalStorage();

        this.baseLength = calculateBaseLength(this.currentLevel);
        this.distanceThreshold = calculateLevelThreshold(this.currentLevel);

        // State specific to the current run
        this.runDistance = 0;
        this.runScore = 0;
    }

    /**
     * Updates the run distance and checks for level completion.
     * @param {number} distanceTraveled - Distance traveled this frame.
     * @returns {boolean} True if the level has been completed.
     */
    updateDistance(distanceTraveled) {
        this.runDistance += distanceTraveled;
        // Debug log to check distance (Optional, remove in production)
        // console.log(`Distance: ${Math.floor(this.runDistance)} / ${this.distanceThreshold}`);
        return this.runDistance >= this.distanceThreshold;
    }

    /**
     * Handles successful completion of the current level.
     */
    levelComplete(earnedRunScore) {
        // 1. Add current run score to global net worth
        this.globalNetWorth += earnedRunScore;

        // 2. Advance the level
        this.currentLevel++;

        // 3. Save progress
        this.saveToLocalStorage();

        // 4. Recalculate parameters for the next level
        this.baseLength = calculateBaseLength(this.currentLevel);
        this.distanceThreshold = calculateLevelThreshold(this.currentLevel);

        // 5. Reset run metrics for the new level
        this.runDistance = 0;
        this.runScore = 0;
    }

    /**
     * Resets the run metrics without changing the level or global score.
     */
    resetRun() {
        this.runDistance = 0;
        this.runScore = 0;
        // Re-apply the base length for the current level
        this.baseLength = calculateBaseLength(this.currentLevel);
        this.distanceThreshold = calculateLevelThreshold(this.currentLevel);
    }

    // --- Local Storage Handling ---
    saveToLocalStorage() {
        const data = {
            netWorth: this.globalNetWorth,
            level: this.currentLevel
        };
        localStorage.setItem('cashRun_saveData', JSON.stringify(data));
    }

    loadFromLocalStorage() {
        const json = localStorage.getItem('cashRun_saveData');
        if (json) {
            try {
                const data = JSON.parse(json);
                this.globalNetWorth = data.netWorth || INITIAL_NET_WORTH;
                this.currentLevel = data.level || INITIAL_LEVEL;
            } catch (e) {
                console.error("Error loading save data", e);
            }
        }
    }

    // --- Firebase Hook ---
    load(data) {
        if (data) {
            this.globalNetWorth = data.score || this.globalNetWorth;
            this.currentLevel = data.level || this.currentLevel;
            this.baseLength = calculateBaseLength(this.currentLevel);
            this.distanceThreshold = calculateLevelThreshold(this.currentLevel);
            this.saveToLocalStorage(); 
        }
    }

    getSaveData() {
        return {
            score: this.globalNetWorth,
            level: this.currentLevel
        };
    }
}

// Export the class for use in index.html
export default LevelManager;