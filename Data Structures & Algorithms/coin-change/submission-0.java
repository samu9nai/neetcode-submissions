class Solution {
    public int coinChange(int[] coins, int amount) {
        int[] dp = new int[amount + 1];

        Arrays.fill(dp, amount + 1);
        dp[0] = 0;

        for (int cur = 1; cur <= amount; cur++) {
            for (int coin : coins) {
                if (cur - coin >= 0) {
                    dp[cur] = Math.min(dp[cur], dp[cur - coin] + 1);
                }
            }
        }

        return dp[amount] == amount + 1 ? -1 : dp[amount];
    }
}