/** Deterministic streak reward schedule shared by solo and multiplayer combat. */
export function rewardsForKillStreak(streak) {
  const n = Math.max(0, Math.floor(Number(streak) || 0));
  const rewards = [];
  if (n > 0 && n % 5 === 0) rewards.push('drone');
  if (n > 0 && n % 10 === 0) rewards.push('ss-strike');
  if (n === 20) rewards.push('susi-sword');
  return rewards;
}

export function nextKillStreakReward(streak) {
  const n = Math.max(0, Math.floor(Number(streak) || 0));
  if (n < 5) return { at: 5, id: 'drone', name: "V's Eye View" };
  if (n < 10) return { at: 10, id: 'ss-strike', name: 'SS Strike' };
  if (n < 20) return { at: 20, id: 'susi-sword', name: "Susi's Sword" };
  return null;
}
