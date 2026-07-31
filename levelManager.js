// Constants for game progression
const INITIAL_LEVEL = 1;
const INITIAL_NET_WORTH = 0;

// Progression Formulas
// Level Threshold (Distance in pixels to travel to pass the current level)
const BASE_DISTANCE_THRESHOLD = 1500;
// INCREASED from 500 to 800 to make level length increase more noticeable
const DISTANCE_INCREMENT_PER_LEVEL = 800; 

// Base Length (Initial number of bills the snake starts with at a given level)
const INITIAL_BASE_LENGTH = 5;
const LENGTH_INCREMENT_PER_LEVEL = 1;

/**
 * Calculates the required distance to travel to complete the given level.
 * @param {number} level - The current level number (N).
 * @returns {number} The distance threshold in pixels.
 */
function calculateLevelThreshold(level) {
    return BASE_DISTANCE_THRESHOLD + (level * DISTANCE_INCREMENT_PER_LEVEL);
}

/**
 * Calculates the starting snake length for the given level.
 * @param {number} level - The current level number (N).
 * @returns {number} The starting length of the snake/bills.
 */
function calculateBaseLength(level) {
    return INITIAL_BASE_LENGTH + level;
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