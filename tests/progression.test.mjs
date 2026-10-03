import assert from 'node:assert/strict';
import {
    createCheckpointSnapshot,
    getChallengeProfile,
    getLiveEconomy
} from '../levelManager.js';

const levels = [1, 20, 55];
const profiles = levels.map(getChallengeProfile);

for (const profile of profiles) {
    const { low, medium, high } = profile.billBands;

    assert.ok(profile.startingWallet >= 5);
    assert.ok(low.min <= low.max);
    assert.ok(low.max < medium.min);
    assert.ok(medium.min <= medium.max);
    assert.ok(medium.max < high.min);
    assert.ok(high.min <= high.max);
    assert.ok(profile.bag.min <= profile.bag.max);
    assert.ok(profile.bag.max < high.min);
    assert.ok(profile.spawnInterval.min > 0);
    assert.ok(profile.spawnInterval.min <= profile.spawnInterval.max);
    assert.ok(profile.speed.initial <= profile.speed.max);

    const weakEconomy = getLiveEconomy(profile, profile.startingWallet);
    const strongEconomy = getLiveEconomy(profile, profile.startingWallet * 4);
    assert.ok(weakEconomy.safe.max <= Math.floor(profile.startingWallet * 0.5));
    assert.ok(weakEconomy.safe.max < weakEconomy.risky.min);
    assert.ok(weakEconomy.risky.max < weakEconomy.dangerous.min);
    assert.ok(weakEconomy.dangerous.max <= profile.economy.blockValueCap);
    assert.ok(weakEconomy.bag.max < weakEconomy.risky.min);
    assert.ok(strongEconomy.safe.max <= profile.economy.blockValueCap);
    assert.equal(
        getLiveEconomy(profile, Math.floor(profile.startingWallet * 0.6)).needsRecovery,
        true
    );
}

assert.ok(profiles[0].startingWallet < profiles[2].startingWallet);
assert.ok(profiles[2].startingWallet < 20);
assert.ok(profiles[0].speed.initial < profiles[2].speed.initial);
assert.ok(profiles[0].speed.max < profiles[2].speed.max);
assert.ok(profiles[0].distanceThreshold < profiles[2].distanceThreshold);

const checkpoint = createCheckpointSnapshot({
    distance: 1234.9,
    wallet: 8.9,
    score: 456.7,
    speed: 7.2
});
assert.deepEqual(checkpoint, { distance: 1234.9, wallet: 8, score: 456, speed: 7.2 });

console.log('Progression profile checks passed for levels 1, 20, and 55.');
