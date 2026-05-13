class Solution {
    public int findCircleNum(int[][] isConnected) {
        int n = isConnected.length;
        boolean[] visited = new boolean[n];

        int provinces = 0;

        for (int i = 0; i < n; i++) {
            if (!visited[i]) {
                provinces++;
                dfs(i, isConnected, visited);
            }
        }

        return provinces;
    }

    private void dfs(int cur, int[][] isConnected, boolean[] visited) {
        visited[cur] = true;

        int n = isConnected.length;

        for (int next = 0; next < n; next++) {
            if (isConnected[cur][next] == 1 && !visited[next]) {
                dfs(next, isConnected, visited);
            }
        }
    }
}